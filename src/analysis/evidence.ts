import * as ts from 'typescript';
import { FunctionInfo } from './behaviors';

/** Signals of intent that live in the code itself, independent of the implementation. */
export interface DocInfo {
  summary?: string;
  tags: { name: string; text: string }[];
}

export function docOf(fn: FunctionInfo): DocInfo {
  const doc: DocInfo = { tags: [] };
  for (const item of ts.getJSDocCommentsAndTags(fn.host)) {
    if (ts.isJSDoc(item)) {
      const summary = ts.getTextOfJSDocComment(item.comment)?.trim();
      if (summary) doc.summary = summary;
      item.tags?.forEach((tag) => doc.tags.push(tagOf(tag)));
    } else {
      doc.tags.push(tagOf(item));
    }
  }
  return doc;
}

function tagOf(tag: ts.JSDocTag): { name: string; text: string } {
  const comment = ts.getTextOfJSDocComment(tag.comment)?.trim() ?? '';
  const text = ts.isJSDocParameterTag(tag) ? `${tag.name.getText()} ${comment}`.trim() : comment;
  return { name: tag.tagName.text, text };
}

/** `isAdult` → ["is", "adult"]; `Cart.addItem` → ["cart", "add", "item"]; `parseURL` → ["parse", "url"]. */
export function splitIdentifier(name: string): string[] {
  return name
    .split(/[._\-\s]+/)
    .flatMap((part) => part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [])
    .map((word) => word.toLowerCase());
}

/** `feature/PROJ-123-allow-18-year-olds` → { ticket: "PROJ-123", summary: "allow 18 year olds" }. */
export function parseBranchName(branch: string | undefined): { ticket?: string; summary?: string } | undefined {
  if (!branch || /^(main|master|develop|dev|trunk|HEAD)$/.test(branch)) return undefined;
  const name = branch.slice(branch.lastIndexOf('/') + 1);
  const ticket = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/.exec(name)?.[1];
  const summary = (ticket ? name.replace(ticket, '') : name).split(/[-_]+/).filter(Boolean).join(' ');
  return { ticket: ticket?.toUpperCase(), summary: summary || undefined };
}
