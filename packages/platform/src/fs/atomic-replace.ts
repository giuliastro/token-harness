/** Windows sharing violations can outlive an individual reader; never unlink the target. */
export async function replaceAtomically(input: {
  source: string;
  target: string;
  nativeWindows: boolean;
  rename(source: string, target: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
}): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await input.rename(input.source, input.target);
      return;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (
        !input.nativeWindows ||
        attempt >= 50 ||
        !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')
      )
        throw error;
      await input.wait(Math.min(10 * 2 ** attempt, 100));
    }
  }
}
