from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected one exact match, found {text.count(old)}")
    target.write_text(text.replace(old, new))


replace(
    "apps/cli/src/guided-stack-client.ts",
    """    if (component.managedByTokenHarness) {
      const remove = node('button', 'Remove managed integration', 'secondary');
      remove.type = 'button';
      remove.dataset.operation = 'remove';
      remove.addEventListener('click', () =>
        window.dispatchEvent(
          new CustomEvent('token-harness:remove-provider', {
            detail: { provider: component.providerId },
          }),
        ),
      );
      details.append(remove);
    } else if (component.configured) {
      details.append(
        node(
          'p',
          'This integration is not owned by Token Harness, so this dashboard will not remove it.',
          'caption',
        ),
      );
    }
""",
    """    if (component.managedByTokenHarness || component.configured) {
      const remove = node(
        'button',
        component.managedByTokenHarness
          ? 'Remove managed integration'
          : 'Check removable managed changes',
        'secondary',
      );
      remove.type = 'button';
      remove.dataset.operation = 'remove';
      remove.addEventListener('click', () =>
        window.dispatchEvent(
          new CustomEvent('token-harness:remove-provider', {
            detail: { provider: component.providerId },
          }),
        ),
      );
      details.append(remove);
      if (!component.managedByTokenHarness)
        details.append(
          node(
            'p',
            'The provider installation is user-owned. This check can only remove configuration changes that Token Harness previously recorded as its own.',
            'caption',
          ),
        );
    }
""",
)

replace(
    "apps/cli/test/guided-component-uninstall.test.ts",
    """  assert.match(GUIDE_STACK_JS, /component\\.managedByTokenHarness/);
  assert.match(GUIDE_STACK_JS, /token-harness:remove-provider/);
""",
    """  assert.match(
    GUIDE_STACK_JS,
    /component\\.managedByTokenHarness \\|\\| component\\.configured/,
  );
  assert.match(GUIDE_STACK_JS, /provider installation is user-owned/);
  assert.match(GUIDE_STACK_JS, /token-harness:remove-provider/);
""",
)
