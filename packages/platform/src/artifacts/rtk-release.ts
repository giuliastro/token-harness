import { createHash } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { gunzipSync, inflateRawSync } from 'node:zlib';

import {
  digestBytes,
  parseSemanticVersion,
  processSucceeded,
  type FileSystemPort,
  type PlatformFacts,
  type ProcessRunner,
} from '@token-harness/core';

import { NodeFileSystem } from '../fs/node-filesystem.js';

export const RTK_WINDOWS_RELEASE_ASSET = 'rtk-x86_64-pc-windows-msvc.zip';
export const RTK_RELEASE_METADATA_DESTINATION = 'api.github.com (rtk-ai/rtk release metadata)';
export const RTK_RELEASE_ASSET_DESTINATION = 'github.com (rtk-ai/rtk release asset)';

const RELEASE_API_PREFIX = 'https://api.github.com/repos/rtk-ai/rtk/releases/tags/';
const RELEASE_DOWNLOAD_PREFIX = 'https://github.com/rtk-ai/rtk/releases/download/';
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 20_000;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const TAR_BLOCK_BYTES = 512;

export interface RtkReleaseAssetSelection {
  name: string;
  executableName: 'rtk' | 'rtk.exe';
  archiveFormat: 'tar.gz' | 'zip';
}

/** Return only assets that upstream publishes for a known native OS/architecture pair. */
export function rtkReleaseAssetForPlatform(
  platform: PlatformFacts,
): RtkReleaseAssetSelection | null {
  if (platform.os === 'windows' && !platform.isWsl && platform.arch === 'x64') {
    return {
      name: RTK_WINDOWS_RELEASE_ASSET,
      executableName: 'rtk.exe',
      archiveFormat: 'zip',
    };
  }
  if (platform.os === 'linux') {
    if (platform.arch === 'x64') {
      return {
        name: 'rtk-x86_64-unknown-linux-musl.tar.gz',
        executableName: 'rtk',
        archiveFormat: 'tar.gz',
      };
    }
    if (platform.arch === 'arm64') {
      return {
        name: 'rtk-aarch64-unknown-linux-gnu.tar.gz',
        executableName: 'rtk',
        archiveFormat: 'tar.gz',
      };
    }
  }
  if (platform.os === 'macos') {
    if (platform.arch === 'x64') {
      return {
        name: 'rtk-x86_64-apple-darwin.tar.gz',
        executableName: 'rtk',
        archiveFormat: 'tar.gz',
      };
    }
    if (platform.arch === 'arm64') {
      return {
        name: 'rtk-aarch64-apple-darwin.tar.gz',
        executableName: 'rtk',
        archiveFormat: 'tar.gz',
      };
    }
  }
  return null;
}

interface ResponseBodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel?(): Promise<void>;
}

interface ResponseLike {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  readonly body: { getReader(): ResponseBodyReader } | null;
}

export type ReleaseFetch = (
  url: string,
  init: {
    method: 'GET';
    headers: Readonly<Record<string, string>>;
    redirect: 'manual';
    signal: AbortSignal;
  },
) => Promise<ResponseLike>;

const nativeFetch: ReleaseFetch = async (url, init) => fetch(url, init);

export interface RtkReleaseAsset extends RtkReleaseAssetSelection {
  version: string;
  tag: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
}

export type RtkReleaseQuery =
  | { status: 'found'; asset: RtkReleaseAsset }
  | { status: 'unavailable' | 'invalid'; message: string };

export interface RtkReleaseRollbackHandle {
  targetPath: string;
  backupPath: string;
  previousDigest: string;
  replacementDigest: string;
  previousMode: string | null;
  previousVersion: string | null;
  replacementVersion: string;
}

export type RtkReleaseInstallResult =
  | {
      status: 'installed';
      handle: RtkReleaseRollbackHandle;
      backupPath: string;
    }
  | {
      status: 'rolled-back';
      code: string;
      message: string;
      backupPath: string | null;
    }
  | {
      status: 'dirty';
      code: string;
      message: string;
      backupPath: string | null;
    }
  | {
      status: 'failed';
      code: string;
      message: string;
      backupPath: string | null;
    };

export type RtkReleaseRollbackResult =
  | { status: 'rolled-back'; message: string }
  | { status: 'dirty'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function normalizeSha256(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^sha256:([0-9a-f]{64})$/i.exec(value.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

function allowedMetadataUrl(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.hostname === 'api.github.com' &&
    url.pathname.startsWith('/repos/rtk-ai/rtk/releases/')
  );
}

function allowedAssetUrl(url: URL, initial: boolean): boolean {
  if (url.protocol !== 'https:') return false;
  if (initial) {
    return (
      url.hostname === 'github.com' && url.pathname.startsWith('/rtk-ai/rtk/releases/download/')
    );
  }
  return (
    url.hostname === 'github.com' ||
    url.hostname === 'release-assets.githubusercontent.com' ||
    url.hostname === 'objects.githubusercontent.com'
  );
}

async function readBounded(response: ResponseLike, maximumBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0 || length > maximumBytes) {
      throw new Error(`response length ${declared} exceeds the ${String(maximumBytes)} byte limit`);
    }
  }

  if (response.body === null) throw new Error('response body is missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    const chunk = next.value ?? new Uint8Array();
    total += chunk.byteLength;
    if (total > maximumBytes) {
      await reader.cancel?.();
      throw new Error(`response exceeded the ${String(maximumBytes)} byte limit`);
    }
    chunks.push(chunk);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function fetchBounded(input: {
  fetchImpl: ReleaseFetch;
  url: string;
  maximumBytes: number;
  kind: 'metadata' | 'asset';
}): Promise<Uint8Array> {
  let current = new URL(input.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const allowed =
        input.kind === 'metadata'
          ? allowedMetadataUrl(current)
          : allowedAssetUrl(current, redirect === 0);
      if (!allowed)
        throw new Error(`refused release URL host/path ${current.origin}${current.pathname}`);

      const response = await input.fetchImpl(current.toString(), {
        method: 'GET',
        headers: {
          Accept:
            input.kind === 'metadata' ? 'application/vnd.github+json' : 'application/octet-stream',
          'User-Agent': 'token-harness',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'manual',
        signal: controller.signal,
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirect === MAX_REDIRECTS) throw new Error('release download exceeded redirect limit');
        const location = response.headers.get('location');
        if (location === null) throw new Error('release redirect omitted Location');
        current = new URL(location, current);
        continue;
      }
      if (!response.ok)
        throw new Error(`release endpoint returned HTTP ${String(response.status)}`);
      return await readBounded(response, input.maximumBytes);
    }
    throw new Error('release endpoint did not produce a response');
  } finally {
    clearTimeout(timer);
  }
}

function parseReleaseMetadata(
  value: unknown,
  version: string,
  selection: RtkReleaseAssetSelection,
): RtkReleaseQuery {
  if (!isRecord(value)) return { status: 'invalid', message: 'release metadata is not an object' };
  const tag = `v${version}`;
  if (value['tag_name'] !== tag || value['draft'] !== false || value['prerelease'] !== false) {
    return {
      status: 'invalid',
      message: `release metadata does not describe the stable reviewed tag ${tag}`,
    };
  }
  const assets = value['assets'];
  if (!Array.isArray(assets))
    return { status: 'invalid', message: 'release metadata has no asset list' };
  const matching = assets.filter((asset) => isRecord(asset) && asset['name'] === selection.name);
  if (matching.length !== 1) {
    return {
      status: 'invalid',
      message: `release ${tag} must contain exactly one ${selection.name} asset`,
    };
  }

  const asset = matching[0];
  if (!isRecord(asset)) return { status: 'invalid', message: 'release asset is malformed' };
  const digest = normalizeSha256(asset['digest']);
  const size = integer(asset['size']);
  const downloadUrl =
    typeof asset['browser_download_url'] === 'string' ? asset['browser_download_url'] : null;
  if (digest === null) {
    return { status: 'invalid', message: `${selection.name} has no published SHA-256` };
  }
  if (size === null || size <= 0 || size > MAX_ARCHIVE_BYTES) {
    return {
      status: 'invalid',
      message: `${selection.name} has an invalid or excessive published size`,
    };
  }
  if (downloadUrl === null) {
    return { status: 'invalid', message: `${selection.name} has no download URL` };
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(downloadUrl);
  } catch {
    return {
      status: 'invalid',
      message: `${selection.name} has an invalid download URL`,
    };
  }
  const expectedPrefix = `${RELEASE_DOWNLOAD_PREFIX}${tag}/`;
  if (!allowedAssetUrl(parsedUrl, true) || !downloadUrl.startsWith(expectedPrefix)) {
    return {
      status: 'invalid',
      message: `${selection.name} points outside the reviewed rtk-ai/rtk release path`,
    };
  }
  const expectedContentType =
    selection.archiveFormat === 'zip' ? 'application/zip' : 'application/gzip';
  if (asset['content_type'] !== expectedContentType) {
    return {
      status: 'invalid',
      message: `${selection.name} is not published as ${expectedContentType}`,
    };
  }

  return {
    status: 'found',
    asset: {
      ...selection,
      version,
      tag,
      downloadUrl,
      sha256: digest,
      sizeBytes: size,
    },
  };
}

function u16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.length) throw new Error('ZIP structure is truncated');
  return buffer.readUInt16LE(offset);
}

function u32(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) throw new Error('ZIP structure is truncated');
  return buffer.readUInt32LE(offset);
}

/** Extract exactly one root `rtk.exe`; every other archive path is ignored rather than written. */
export function extractRtkExeFromVerifiedZip(bytes: Uint8Array): Uint8Array {
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, zip.length - 65_557);
  let eocd = -1;
  for (let offset = zip.length - 22; offset >= minimum; offset -= 1) {
    if (u32(zip, offset) === ZIP_EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory record was not found');

  const disk = u16(zip, eocd + 4);
  const centralDisk = u16(zip, eocd + 6);
  const diskEntries = u16(zip, eocd + 8);
  const entries = u16(zip, eocd + 10);
  const centralSize = u32(zip, eocd + 12);
  const centralOffset = u32(zip, eocd + 16);
  const commentLength = u16(zip, eocd + 20);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entries) {
    throw new Error('multi-disk ZIP releases are not supported');
  }
  if (
    entries === 0 ||
    entries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error('ZIP64 or empty release archives are not supported');
  }
  if (entries > 1024) throw new Error('release ZIP contains too many entries');
  if (eocd + 22 + commentLength > zip.length || centralOffset + centralSize > eocd) {
    throw new Error('ZIP central directory is out of bounds');
  }

  let cursor = centralOffset;
  let extracted: Uint8Array | null = null;
  for (let index = 0; index < entries; index += 1) {
    if (u32(zip, cursor) !== ZIP_CENTRAL_SIGNATURE)
      throw new Error('ZIP central entry is malformed');
    const flags = u16(zip, cursor + 8);
    const method = u16(zip, cursor + 10);
    const compressedSize = u32(zip, cursor + 20);
    const uncompressedSize = u32(zip, cursor + 24);
    const nameLength = u16(zip, cursor + 28);
    const extraLength = u16(zip, cursor + 30);
    const entryCommentLength = u16(zip, cursor + 32);
    const diskStart = u16(zip, cursor + 34);
    const localOffset = u32(zip, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (end > zip.length) throw new Error('ZIP central entry exceeds archive bounds');
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor = end;

    if (name !== 'rtk.exe') continue;
    if (extracted !== null) throw new Error('release ZIP contains more than one root rtk.exe');
    if ((flags & 0x1) !== 0) throw new Error('encrypted ZIP entries are not supported');
    if (diskStart !== 0 || localOffset === 0xffffffff)
      throw new Error('ZIP64 entries are not supported');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('ZIP64 entry sizes are not supported');
    }
    if (uncompressedSize <= 0 || uncompressedSize > MAX_EXECUTABLE_BYTES) {
      throw new Error('rtk.exe has an invalid or excessive uncompressed size');
    }
    if (u32(zip, localOffset) !== ZIP_LOCAL_SIGNATURE)
      throw new Error('rtk.exe local ZIP header is missing');
    const localNameLength = u16(zip, localOffset + 26);
    const localExtraLength = u16(zip, localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zip.length) throw new Error('rtk.exe compressed data exceeds archive bounds');
    const localName = zip
      .subarray(localNameStart, localNameStart + localNameLength)
      .toString('utf8');
    if (localName !== name) throw new Error('rtk.exe local and central ZIP names disagree');

    const compressed = zip.subarray(dataStart, dataEnd);
    let payload: Buffer;
    if (method === 0) payload = Buffer.from(compressed);
    else if (method === 8) {
      payload = inflateRawSync(compressed, { maxOutputLength: MAX_EXECUTABLE_BYTES });
    } else {
      throw new Error(`rtk.exe uses unsupported ZIP compression method ${String(method)}`);
    }
    if (payload.byteLength !== uncompressedSize)
      throw new Error('rtk.exe uncompressed size does not match ZIP metadata');
    extracted = new Uint8Array(payload);
  }

  if (extracted === null) throw new Error('release ZIP contains no root rtk.exe');
  return extracted;
}

function tarText(buffer: Buffer, offset: number, length: number): string {
  const field = buffer.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString('utf8');
}

function tarOctal(buffer: Buffer, offset: number, length: number, fieldName: string): number {
  const raw = tarText(buffer, offset, length).trim();
  if (raw === '') return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error(`tar ${fieldName} is not an octal value`);
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`tar ${fieldName} is outside the supported range`);
  return value;
}

/** Extract exactly a root `rtk` file from a bounded gzip-compressed tar archive. */
export function extractRtkBinaryFromVerifiedTarGz(bytes: Uint8Array): Uint8Array {
  const compressed = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tar = gunzipSync(compressed, { maxOutputLength: MAX_EXPANDED_ARCHIVE_BYTES });
  let cursor = 0;
  let sawEnd = false;
  let extracted: Uint8Array | null = null;

  while (cursor + TAR_BLOCK_BYTES <= tar.length) {
    const header = tar.subarray(cursor, cursor + TAR_BLOCK_BYTES);
    if (header.every((byte) => byte === 0)) {
      sawEnd = true;
      break;
    }

    const expectedChecksum = tarOctal(header, 148, 8, 'checksum');
    let checksum = 0;
    for (let index = 0; index < TAR_BLOCK_BYTES; index += 1) {
      checksum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
    }
    if (checksum !== expectedChecksum) throw new Error('tar header checksum does not match');

    const name = tarText(header, 0, 100);
    const prefix = tarText(header, 345, 155);
    const path = prefix === '' ? name : `${prefix}/${name}`;
    const type = header[156] === 0 ? '\0' : String.fromCharCode(header[156] ?? 0);
    const size = tarOctal(header, 124, 12, 'file size');
    if (size > MAX_EXECUTABLE_BYTES)
      throw new Error('tar entry exceeds the RTK executable size limit');
    if (type !== '\0' && type !== '0' && type !== '5') {
      throw new Error(`tar entry type ${JSON.stringify(type)} is not supported`);
    }
    const dataStart = cursor + TAR_BLOCK_BYTES;
    const dataEnd = dataStart + size;
    const next = dataStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
    if (dataEnd > tar.length || next > tar.length)
      throw new Error('tar entry exceeds archive bounds');

    if (path === 'rtk') {
      if (type === '5') throw new Error('root rtk tar entry is a directory');
      if (extracted !== null) throw new Error('release tar contains more than one root rtk file');
      if (size === 0) throw new Error('root rtk tar entry is empty');
      extracted = new Uint8Array(tar.subarray(dataStart, dataEnd));
    }
    cursor = next;
  }

  if (!sawEnd) throw new Error('tar end marker was not found');
  if (extracted === null) throw new Error('release tar contains no root rtk file');
  return extracted;
}

function versionAppears(output: string, version: string): boolean {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)v?${escaped}(?:\\s|$)`, 'm').test(output.trim());
}

export class NodeRtkReleaseRuntime {
  private readonly fs: NodeFileSystem;
  private readonly runner: ProcessRunner;
  private readonly fetchImpl: ReleaseFetch;

  constructor(input: { fs: NodeFileSystem; runner: ProcessRunner; fetchImpl?: ReleaseFetch }) {
    this.fs = input.fs;
    this.runner = input.runner;
    this.fetchImpl = input.fetchImpl ?? nativeFetch;
  }

  async query(version: string, platform: PlatformFacts): Promise<RtkReleaseQuery> {
    if (parseSemanticVersion(version) === null) {
      return { status: 'invalid', message: `${version} is not a semantic RTK release` };
    }
    const selection = rtkReleaseAssetForPlatform(platform);
    if (selection === null) {
      return {
        status: 'invalid',
        message: `RTK ${version} does not publish a managed binary for ${platform.os}/${platform.arch}`,
      };
    }
    const url = `${RELEASE_API_PREFIX}v${version}`;
    let bytes: Uint8Array;
    try {
      bytes = await fetchBounded({
        fetchImpl: this.fetchImpl,
        url,
        maximumBytes: MAX_METADATA_BYTES,
        kind: 'metadata',
      });
    } catch (error) {
      return {
        status: 'unavailable',
        message: `RTK release metadata could not be read: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    try {
      const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      return parseReleaseMetadata(value, version, selection);
    } catch (error) {
      return {
        status: 'invalid',
        message: `RTK release metadata is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async download(asset: RtkReleaseAsset): Promise<Uint8Array> {
    const archive = await fetchBounded({
      fetchImpl: this.fetchImpl,
      url: asset.downloadUrl,
      maximumBytes: Math.min(MAX_ARCHIVE_BYTES, Math.max(asset.sizeBytes, 1)),
      kind: 'asset',
    });
    if (archive.byteLength !== asset.sizeBytes) {
      throw new Error(
        `downloaded ${String(archive.byteLength)} bytes but GitHub published ${String(asset.sizeBytes)}`,
      );
    }
    const digest = createHash('sha256').update(archive).digest('hex');
    if (digest !== asset.sha256)
      throw new Error('downloaded RTK release archive does not match GitHub published SHA-256');
    return archive;
  }

  private async verifyExecutable(path: string, version: string, cwd: string): Promise<boolean> {
    const result = await this.runner.run({
      executable: path,
      args: ['--version'],
      cwd,
      timeoutMs: 5_000,
      maxOutputBytes: 4096,
    });
    return (
      processSucceeded(result) && versionAppears(`${result.stdout}\n${result.stderr}`, version)
    );
  }

  private async restoreFromBackup(
    handle: RtkReleaseRollbackHandle,
    cwd: string,
  ): Promise<RtkReleaseRollbackResult> {
    try {
      const currentStat = await this.fs.stat(handle.targetPath);
      if (currentStat === null || currentStat.kind !== 'file') {
        return {
          status: 'dirty',
          message: 'RTK target disappeared before rollback could restore it',
        };
      }
      const currentDigest = digestBytes(await this.fs.readFile(handle.targetPath));
      if (currentDigest !== handle.replacementDigest) {
        return {
          status: 'dirty',
          message:
            'RTK target changed after replacement, so automatic rollback refused to overwrite it',
        };
      }
      const backup = await this.fs.readFile(handle.backupPath);
      if (digestBytes(backup) !== handle.previousDigest) {
        return {
          status: 'dirty',
          message: 'RTK rollback backup no longer matches its recorded digest',
        };
      }

      const directory = this.fs.dirname(handle.targetPath);
      const stage = this.fs.join(
        directory,
        `.rtk.token-harness.rollback-${handle.previousDigest.slice(-12)}.tmp`,
      );
      const displaced = this.fs.join(directory, '.rtk.token-harness.rollback-displaced');
      if ((await this.fs.stat(displaced)) !== null) {
        return {
          status: 'dirty',
          message: `RTK rollback staging path already exists: ${displaced}`,
        };
      }
      await this.fs.writeFile(stage, backup, handle.previousMode);
      await rename(handle.targetPath, displaced);
      try {
        await rename(stage, handle.targetPath);
      } catch (error) {
        await rename(displaced, handle.targetPath).catch(() => undefined);
        await rm(stage, { force: true }).catch(() => undefined);
        return {
          status: 'dirty',
          message: `RTK rollback could not replace the executable: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      await rm(displaced, { force: true });
      const restoredDigest = digestBytes(await this.fs.readFile(handle.targetPath));
      if (restoredDigest !== handle.previousDigest) {
        return {
          status: 'dirty',
          message: 'RTK rollback completed but exact previous bytes were not restored',
        };
      }
      if (
        handle.previousVersion !== null &&
        !(await this.verifyExecutable(handle.targetPath, handle.previousVersion, cwd))
      ) {
        return {
          status: 'dirty',
          message: 'RTK previous bytes were restored but the previous version no longer starts',
        };
      }
      return {
        status: 'rolled-back',
        message: 'RTK previous executable bytes and version were restored and verified',
      };
    } catch (error) {
      return {
        status: 'dirty',
        message: `RTK rollback failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async rollback(handle: RtkReleaseRollbackHandle, cwd: string): Promise<RtkReleaseRollbackResult> {
    return this.restoreFromBackup(handle, cwd);
  }

  async install(input: {
    asset: RtkReleaseAsset;
    targetPath: string;
    previousVersion: string | null;
    stateRoot: string;
    cwd: string;
  }): Promise<RtkReleaseInstallResult> {
    const targetName = this.fs.basename(input.targetPath).toLowerCase();
    if (targetName !== input.asset.executableName.toLowerCase()) {
      return {
        status: 'failed',
        code: 'rtk-release-target-refused',
        message: `Resolved RTK target does not match the release executable name ${input.asset.executableName}: ${input.targetPath}`,
        backupPath: null,
      };
    }
    const targetStat = await this.fs.stat(input.targetPath);
    if (targetStat === null || targetStat.kind !== 'file') {
      return {
        status: 'failed',
        code: 'rtk-release-target-missing',
        message: 'The resolved RTK executable disappeared before the release update began',
        backupPath: null,
      };
    }
    if (
      input.asset.executableName === 'rtk' &&
      (targetStat.mode === null || (Number.parseInt(targetStat.mode, 8) & 0o111) === 0)
    ) {
      return {
        status: 'failed',
        code: 'rtk-release-target-not-executable',
        message: `Resolved RTK target does not have readable POSIX executable permissions: ${input.targetPath}`,
        backupPath: null,
      };
    }

    let archive: Uint8Array;
    let replacement: Uint8Array;
    try {
      archive = await this.download(input.asset);
      replacement =
        input.asset.archiveFormat === 'zip'
          ? extractRtkExeFromVerifiedZip(archive)
          : extractRtkBinaryFromVerifiedTarGz(archive);
    } catch (error) {
      return {
        status: 'failed',
        code: 'rtk-release-artifact-invalid',
        message: error instanceof Error ? error.message : String(error),
        backupPath: null,
      };
    }

    const previous = await this.fs.readFile(input.targetPath);
    const previousDigest = digestBytes(previous);
    const replacementDigest = digestBytes(replacement);
    const backupDirectory = this.fs.join(input.stateRoot, 'backups', 'rtk-release');
    const backupPath = this.fs.join(
      backupDirectory,
      `rtk-${input.previousVersion ?? 'unknown'}-${previousDigest.slice(-16)}.bin`,
    );
    await this.fs.createDirectory(backupDirectory);
    const existingBackup = await this.fs.stat(backupPath);
    if (existingBackup === null) await this.fs.writeFile(backupPath, previous);
    else if (
      existingBackup.kind !== 'file' ||
      digestBytes(await this.fs.readFile(backupPath)) !== previousDigest
    ) {
      return {
        status: 'failed',
        code: 'rtk-release-backup-conflict',
        message: `Existing RTK backup does not match the executable being replaced: ${backupPath}`,
        backupPath,
      };
    }

    const directory = this.fs.dirname(input.targetPath);
    const stage = this.fs.join(directory, `.rtk.token-harness-${input.asset.version}.tmp`);
    const displaced = this.fs.join(directory, '.rtk.token-harness-previous');
    if ((await this.fs.stat(stage)) !== null || (await this.fs.stat(displaced)) !== null) {
      return {
        status: 'failed',
        code: 'rtk-release-staging-conflict',
        message:
          'An RTK release staging file already exists; refusing to overwrite possible recovery state',
        backupPath,
      };
    }

    try {
      await this.fs.writeFile(stage, replacement, targetStat.mode);
      if (digestBytes(await this.fs.readFile(stage)) !== replacementDigest) {
        throw new Error('staged RTK executable does not match the extracted bytes');
      }
      await rename(input.targetPath, displaced);
      try {
        await rename(stage, input.targetPath);
      } catch (error) {
        await rename(displaced, input.targetPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      await rm(stage, { force: true }).catch(() => undefined);
      const live = await this.fs.stat(input.targetPath);
      if (
        live !== null &&
        live.kind === 'file' &&
        digestBytes(await this.fs.readFile(input.targetPath)) === previousDigest
      ) {
        await rm(displaced, { force: true }).catch(() => undefined);
        return {
          status: 'rolled-back',
          code: 'rtk-release-replacement-failed',
          message: `RTK replacement failed before commit and the previous executable is intact: ${error instanceof Error ? error.message : String(error)}`,
          backupPath,
        };
      }
      return {
        status: 'dirty',
        code: 'rtk-release-replacement-dirty',
        message: `RTK replacement failed and exact restoration could not be verified: ${error instanceof Error ? error.message : String(error)}`,
        backupPath,
      };
    }

    const handle: RtkReleaseRollbackHandle = {
      targetPath: input.targetPath,
      backupPath,
      previousDigest,
      replacementDigest,
      previousMode: targetStat.mode,
      previousVersion: input.previousVersion,
      replacementVersion: input.asset.version,
    };

    if (!(await this.verifyExecutable(input.targetPath, input.asset.version, input.cwd))) {
      const rollback = await this.restoreFromBackup(handle, input.cwd);
      await rm(displaced, { force: true }).catch(() => undefined);
      if (rollback.status === 'rolled-back') {
        return {
          status: 'rolled-back',
          code: 'rtk-release-postcondition-failed',
          message:
            'The verified RTK release bytes were installed but the new version could not be verified; the previous executable was restored. Check OS application-control policy and binary compatibility.',
          backupPath,
        };
      }
      return {
        status: 'dirty',
        code: 'rtk-release-postcondition-rollback-failed',
        message: `The new RTK executable failed its version check and rollback was incomplete: ${rollback.message}`,
        backupPath,
      };
    }

    await rm(displaced, { force: true });
    return { status: 'installed', handle, backupPath };
  }
}

/**
 * Production-only bridge without widening every test port. Commands still receive a FileSystemPort
 * and ProcessRunner; only the real Node filesystem opts into native verified release replacement.
 */
export function rtkReleaseRuntimeFor(
  fs: FileSystemPort,
  runner: ProcessRunner,
  fetchImpl?: ReleaseFetch,
): NodeRtkReleaseRuntime | null {
  return fs instanceof NodeFileSystem
    ? new NodeRtkReleaseRuntime({ fs, runner, ...(fetchImpl === undefined ? {} : { fetchImpl }) })
    : null;
}
