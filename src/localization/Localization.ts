import en from "./en.json";
import de from "./de.json";
import type { SupportedLanguage } from "../config/GameConfig";
import { assertWorldDateTime } from "../core/WorldClock";
import type { WorldDateTime } from "../core/model";

type MessageTree = typeof en;
type LeafPath<T, Prefix extends string = ""> = {
  [Key in keyof T & string]: T[Key] extends string
    ? `${Prefix}${Key}`
    : T[Key] extends readonly unknown[]
      ? never
      : LeafPath<T[Key], `${Prefix}${Key}.`>;
}[keyof T & string];

export type MessageKey = LeafPath<MessageTree>;
const catalogs: Record<SupportedLanguage, MessageTree> = { en, de };

function valueAt(catalog: MessageTree, key: MessageKey): string {
  let value: unknown = catalog;
  for (const segment of key.split(".")) {
    value = (value as Record<string, unknown>)[segment];
  }
  if (typeof value !== "string") throw new Error(`Missing localized message ${key}`);
  return value;
}

export class Localization {
  public constructor(public readonly language: SupportedLanguage) {}

  public get locale(): string {
    return catalogs[this.language].meta.locale;
  }

  public get months(): readonly string[] {
    return catalogs[this.language].months;
  }

  public text(key: MessageKey, variables: Readonly<Record<string, string | number>> = {}): string {
    return valueAt(catalogs[this.language], key).replace(
      /\{([a-zA-Z0-9]+)\}/g,
      (match, name: string) =>
        Object.hasOwn(variables, name) ? String(variables[name]) : match,
    );
  }

  public number(value: number): string {
    return value.toLocaleString(this.locale);
  }

  public worldDateTime(time: WorldDateTime): string {
    assertWorldDateTime(time);
    const year = time.year <= 0 ? 1 - time.year : time.year;
    return this.text("format.worldDate", {
      day: time.day,
      month: this.months[time.month - 1]!,
      year: this.number(year),
      era: this.text(time.year <= 0 ? "terms.bce" : "terms.ce"),
      time: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`,
    });
  }

  public worldDuration(totalMinutes: number): string {
    const rounded = Math.max(0, Math.round(totalMinutes));
    const values = [
      ["format.durationDay", Math.floor(rounded / (24 * 60))],
      ["format.durationHour", Math.floor((rounded % (24 * 60)) / 60)],
      ["format.durationMinute", rounded % 60],
    ] as const;
    return values
      .filter(([, value], index) => value > 0 || (index === 2 && rounded === 0))
      .map(([key, value]) => this.text(key, { value }))
      .join(" ");
  }
}

export function localizeDocument(root: ParentNode, localization: Localization): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    element.textContent = localization.text(element.dataset.i18n as MessageKey);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-aria-label]")) {
    element.setAttribute(
      "aria-label",
      localization.text(element.dataset.i18nAriaLabel as MessageKey),
    );
  }
  document.documentElement.lang = localization.language;
}
