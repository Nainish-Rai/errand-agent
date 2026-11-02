import type { Locator, Page } from "playwright-core";

// How a command names an element, the way a person would: by role and accessible name, label,
// test id or visible text. A positional SELECTOR (CSS, or a Playwright selector such as
// `role=region[name="Run trace"]`) can stand alone or scope the role, label, testid or text lookup.

export interface Target {
  readonly selector?: string;
  readonly role?: string;
  /** Exact accessible name (with role). */
  readonly name?: string;
  /** Part of the accessible name (with role), or visible text (alone). */
  readonly text?: string;
  readonly label?: string;
  readonly testid?: string;
  readonly nth?: number;
}

export const TARGET_FIELDS = ["role", "name", "text", "label", "testid", "nth"] as const;

type AriaRole = Parameters<Page["getByRole"]>[0];

export function describeTarget(target: Target): string {
  const parts = [
    target.selector === undefined ? undefined : JSON.stringify(target.selector),
    target.role === undefined ? undefined : `role=${target.role}`,
    target.name === undefined ? undefined : `name=${JSON.stringify(target.name)}`,
    target.text === undefined ? undefined : `text~${JSON.stringify(target.text)}`,
    target.label === undefined ? undefined : `label=${JSON.stringify(target.label)}`,
    target.testid === undefined ? undefined : `testid=${target.testid}`,
    target.nth === undefined ? undefined : `nth=${target.nth}`,
  ];
  return parts.filter(Boolean).join(" ");
}

export function hasTarget(target: Target): boolean {
  return [target.selector, target.role, target.label, target.testid, target.text].some((value) => value !== undefined);
}

/**
 * Builds the locator. In `assert`, `--text` is the expectation, so the caller passes `textIsName: false`
 * and the text never narrows the match.
 */
export function locatorFor(page: Page, target: Target, { textIsName = true } = {}): Locator {
  const text = textIsName ? target.text : undefined;
  const scope = target.selector === undefined ? page : page.locator(target.selector);
  let locator: Locator;
  if (target.role !== undefined) {
    const role = target.role as AriaRole;
    if (target.name !== undefined) locator = scope.getByRole(role, { name: target.name, exact: true });
    else if (text !== undefined) locator = scope.getByRole(role, { name: text, exact: false });
    else locator = scope.getByRole(role);
  } else if (target.name !== undefined) {
    throw new Error("--name needs --role");
  } else if (target.testid !== undefined) {
    locator = scope.getByTestId(target.testid);
  } else if (target.label !== undefined) {
    locator = scope.getByLabel(target.label, { exact: true });
  } else if (text !== undefined) {
    locator = scope.getByText(text, { exact: false });
  } else if (target.selector !== undefined) {
    locator = page.locator(target.selector);
  } else {
    throw new Error("Name a target: a CSS selector, or --role ROLE --name NAME, --label, --testid or --text");
  }
  return target.nth === undefined ? locator : locator.nth(target.nth);
}
