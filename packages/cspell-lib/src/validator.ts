import type { CSpellUserSettings } from '@cspell/cspell-types';
import * as Settings from './Settings';
import * as Dictionary from './SpellingDictionary';
import { CompoundWordsMethod } from './SpellingDictionary';
import * as TV from './textValidator';

export const diagSource = 'cSpell Checker';

export { IncludeExcludeOptions } from './textValidator';

export interface ValidationIssue extends TV.ValidationResult {
    suggestions?: string[];
}

export interface ValidateTextOptions {
    /** Generate suggestions where there are spelling issues. */
    generateSuggestions?: boolean;
    /** The number of suggestions to generate. The higher the number the longer it takes. */
    numSuggestions?: number;
}

export async function validateText(
    text: string,
    settings: CSpellUserSettings,
    options: ValidateTextOptions = {}
): Promise<ValidationIssue[]> {
    const finalSettings = Settings.finalizeSettings(settings);
    const dict = await Dictionary.getDictionary(finalSettings);
    const issues = [...TV.validateText(text, dict, settingsToValidateOptions(finalSettings))];
    if (!options.generateSuggestions) {
        return issues;
    }
    const withSugs = issues.map((t) => {
        const suggestions = dict
            .suggest(t.text, {
                numSuggestions: options.numSuggestions,
                compoundMethod: CompoundWordsMethod.NONE,
                includeTies: false,
                ignoreCase: !(settings.caseSensitive ?? false),
                timeout: settings.suggestionsTimeout,
                numChanges: settings.suggestionNumChanges,
            })
            .map((r) => r.word);
        return { ...t, suggestions };
    });

    return withSugs;
}

export function settingsToValidateOptions(settings: CSpellUserSettings): TV.ValidationOptions {
    const opt: TV.ValidationOptions = {
        ...settings,
        ignoreCase: !(settings.caseSensitive ?? false),
    };
    return opt;
}

export interface CheckTextInfo {
    // Full text
    text: string;
    // Set of include items
    items: TextInfoItem[];
}

export interface TextInfoItem {
    // the segment of text that is either include or excluded
    text: string;
    startPos: number;
    endPos: number;
    flagIE: IncludeExcludeFlag;
    isError?: boolean;
}

export enum IncludeExcludeFlag {
    INCLUDE = 'I',
    EXCLUDE = 'E',
}

export async function checkText(text: string, settings: CSpellUserSettings): Promise<CheckTextInfo> {
    const validationResult = validateText(text, settings);
    const finalSettings = Settings.finalizeSettings(settings);
    const includeRanges = TV.calcTextInclusionRanges(text, finalSettings);
    const result: TextInfoItem[] = [];
    let lastPos = 0;
    for (const { startPos, endPos } of includeRanges) {
        result.push({
            text: text.slice(lastPos, startPos),
            startPos: lastPos,
            endPos: startPos,
            flagIE: IncludeExcludeFlag.EXCLUDE,
        });
        result.push({
            text: text.slice(startPos, endPos),
            startPos,
            endPos,
            flagIE: IncludeExcludeFlag.INCLUDE,
        });
        lastPos = endPos;
    }
    result.push({
        text: text.slice(lastPos),
        startPos: lastPos,
        endPos: text.length,
        flagIE: IncludeExcludeFlag.EXCLUDE,
    });

    const issues = await validationResult;

    function* merge() {
        let i = 0;
        for (const r of result) {
            if (i >= issues.length || issues[i].offset >= r.endPos) {
                yield r;
                continue;
            }
            const span = { ...r };
            while (i < issues.length && issues[i].offset < span.endPos) {
                const issue = issues[i];
                const endPos = issue.offset;
                const text = span.text.slice(0, endPos - span.startPos);
                const endPosError = issue.offset + issue.text.length;
                yield { ...span, text, endPos };
                yield {
                    ...span,
                    isError: true,
                    startPos: issue.offset,
                    endPos: endPosError,
                    text: issue.text,
                };
                span.text = span.text.slice(endPosError - span.startPos);
                span.startPos = endPosError;
                i += 1;
            }
            yield span;
        }
    }

    return {
        text,
        items: [...merge()].filter((i) => i.startPos < i.endPos),
    };
}
