import { findWord, PartialFindOptions, FindFullResult } from './find';

import * as fs from 'fs-extra';
import * as zlib from 'zlib';
import { importTrie } from './importExport';
import { TrieNode } from './TrieNode';
import * as path from 'path';
import { normalizeWordToLowercase } from './util';

const dutchDictionary = path.join(__dirname, ...'../../../Samples/dicts/nl_compound_trie3.trie.gz'.split('/'));

describe('Validate findWord', () => {
    const pTrie = readTrie(dutchDictionary);

    test('test find exact words preserve case', async () => {
        const trie = await pTrie;

        // cspell:ignore aanvaardbaard
        // Code is not allowed as a full word.
        expect(
            findWord(trie, 'aanvaardbaard', {
                matchCase: true,
                compoundMode: 'none',
            })
        ).toEqual(frFound('aanvaardbaard', true));

        expect(findWord(trie, 'code', { matchCase: true, compoundMode: 'none' })).toEqual({
            found: 'code',
            compoundUsed: false,
            forbidden: false,
        });

        expect(
            findWord(trie, 'code', {
                matchCase: true,
                compoundMode: 'compound',
            })
        ).toEqual({ found: 'code', compoundUsed: false, forbidden: false });
    });

    const tests: [string, PartialFindOptions, FindFullResult][] = [
        ['Code', { matchCase: true, compoundMode: 'none' }, frNotFound()],
        ['code', { matchCase: true, compoundMode: 'none' }, frFound('code')],
        ['cafe', { matchCase: true, compoundMode: 'none' }, frNotFound()],
        ['cafe', { matchCase: false, compoundMode: 'none' }, frFound('cafe')],

        // Compounding enabled, but matching whole words (compounding not used).
        ['Code', { matchCase: true, compoundMode: 'compound' }, frCompoundFound(false)],
        ['code', { matchCase: true, compoundMode: 'compound' }, frFound('code')],
        ['cafe', { matchCase: true, compoundMode: 'compound' }, frFound(false)],
        ['cafe', { matchCase: false, compoundMode: 'compound' }, frFound('cafe')],

        // compound words
        testCompound('buurtbewoner'), // cspell:ignore buurtbewoner
        testCompound('buurtbewoners'), // cspell:ignore buurtbewoners

        // forbidden compounds
        ['aanvaardbaard', { matchCase: true, compoundMode: 'compound' }, frCompoundFound('aanvaardbaard', true)],
    ];

    tests.forEach(function ([word, options, exResult]) {
        test(`Find Word: ${word} ${JSON.stringify(options)}, ${JSON.stringify(exResult)}`, async () => {
            const trie = await pTrie;
            expect(findWord(trie, word, options)).toEqual(exResult);
        });
    });

    sampleWords().forEach((word) => {
        test(`Find Word: ${word}`, async () => {
            const trie = await pTrie;
            const word2 = word[0].toLowerCase() + word.slice(1);
            const r1 = findWord(trie, word, {
                matchCase: true,
                compoundMode: 'compound',
            });
            const r2 =
                r1.found || word === word2
                    ? r1
                    : ((word = word2),
                      findWord(trie, word, {
                          matchCase: true,
                          compoundMode: 'compound',
                      }));
            // console.log(r2);
            expect(r2.found).toEqual(word);
            expect(r2.forbidden).toBe(false);
        });
        test(`Find Word case insensitive: ${word}`, async () => {
            const trie = await pTrie;
            const r = findWord(trie, normalizeWordToLowercase(word), {
                matchCase: false,
                compoundMode: 'compound',
            });
            // console.log(r2);
            expect(r.found).toEqual(normalizeWordToLowercase(word));
            expect(r.forbidden).toBe(false);
        });
    });

    sampleMisspellings().forEach((word) => {
        test(`Check misspelled words: ${word}`, async () => {
            const trie = await pTrie;
            const word2 = word[0].toLowerCase() + word.slice(1);
            const r1 = findWord(trie, word, {
                matchCase: true,
                compoundMode: 'compound',
            });
            const r2 =
                r1.found || word === word2
                    ? r1
                    : ((word = word2),
                      findWord(trie, word, {
                          matchCase: true,
                          compoundMode: 'compound',
                      }));
            // console.log(r2);
            expect(r2.found).toEqual(false);
            expect(r2.forbidden).toBe(false);
        });
        test(`Check misspelled words case insensitive: ${word}`, async () => {
            const trie = await pTrie;
            const r = findWord(trie, normalizeWordToLowercase(word), {
                matchCase: false,
                compoundMode: 'compound',
            });
            // console.log(r2);
            expect(r.found).toEqual(false);
            expect(r.forbidden).toBe(false);
        });
    });
});

function sampleMisspellings(): string[] {
    // cspell:disable
    const text = `
    nieuwjaarnacht
    burgersmeester
    buurtsbewoners
    herdenkingbijeenkomst
    pankoekhuis
    blauwetram
    `;
    // cspell:enable
    return processText(text);
}

function sampleWords(): string[] {
    // cspell:disable
    const text = `
    Arnhem basisschool    burgemeester    buurtbewoners    haarvaten    herdenkingsbijeenkomst
    nabestaanden    onmenselijke    slachtoffers    uitgebrande    verdachten    voorbereiden
    exposé

    De Australische marine heeft honderden inwoners en toeristen uit de kustplaats geëvacueerd
    zo'n mensen vluchtten maandagavond naar het strand toen bosbranden het dorp deels in de as legden en de
    vluchtwegen blokkeerden.

    In het zuidoosten van Australië zijn meer dan 200 brandhaarden.
    De autoriteiten vrezen dat de situatie alleen maar erger wordt door de hoge
    temperaturen en harde wind die voor dit weekend worden verwacht.
    In de deelstaat New Zuid Wales, waar Sydney ligt, geldt de noodtoestand.
    Het Nederlandse ministerie van Buitenlandse Zaken adviseert in het gebied alleen noodzakelijke reizen te maken.

    Nooit eerder waren de jaarlijkse bosbranden in Australië zo ernstig.
    Tot nu toe is een gebied groter dan Nederland afgebrand en zijn meer dan 1400 huizen verwoest.
    Ten minste negentien mensen kwamen om en er zijn tientallen vermisten.

    Verdachten flatbrand Arnhem hebben ook levenslang, zegt Kinderombudsman

    Lange woorden:
    Kindercarnavalsoptochtenvoorbereidingswerkzaamheden
    Meervoudige persoonlijkheidsstoornissen
    Zandzeep mineraalwatersteenstralen
    Randjongerenhangplekkenbeleidsambtenarensalarisbesprekingsafspraken
    Invaliditeitsuitkeringshoofdkwartiervestigingsgebouwfundamentenblauwdruk
    Hottentottententententoonstellingsterrein
    Vervoerdersaansprakelijkheidsverzekering
    Bestuurdersaansprakelijkheidsverzekering
    Overeenstemmingsbeoordelingsprocedures
    `;
    // cspell:enable
    return processText(text);
}

function processText(text: string): string[] {
    return [
        ...new Set(
            text
                .replace(/[.0-9,"“():]/g, ' ')
                .split(/\s+/)
                .sort()
                .filter((a) => !!a)
        ),
    ];
}

function testCompound(word: string, found = true): [string, PartialFindOptions, FindFullResult] {
    return [word, { matchCase: true, compoundMode: 'compound' }, frCompoundFound(found && word)];
}

function frNotFound(compoundUsed = false): FindFullResult {
    return {
        found: false,
        forbidden: false,
        compoundUsed,
    };
}

function frFound(found: string | false, forbidden = false, compoundUsed = false): FindFullResult {
    return {
        found,
        forbidden,
        compoundUsed,
    };
}

function frCompoundFound(found: string | false, forbidden = false, compoundUsed = true): FindFullResult {
    return frFound(found, forbidden, compoundUsed);
}

async function readTrie(filename: string): Promise<TrieNode> {
    const lines = await readTextFile(filename);
    return importTrie(lines);
}

function readTextFile(filename: string): Promise<string[]> {
    const lines = fs
        .readFile(filename)
        .then((buffer) => (/\.gz$/.test(filename) ? zlib.gunzipSync(buffer) : buffer))
        .then((buffer) => buffer.toString('utf8'))
        .then((content) => content.split(/\r?\n/g));
    return lines;
}
