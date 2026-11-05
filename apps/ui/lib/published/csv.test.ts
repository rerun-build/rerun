import { describe, expect, it } from 'vitest'
import { isNumericCell, numericColumns, parseCsv, sniffDelimiter } from './csv'

describe('parseCsv', () => {
    it('splits plain records on LF and CRLF', () => {
        expect(parseCsv('a,b\r\n1,2\n3,4').rows).toEqual([
            ['a', 'b'],
            ['1', '2'],
            ['3', '4'],
        ])
    })

    it('keeps delimiters, line breaks and doubled quotes inside quoted fields', () => {
        expect(parseCsv('name,note\n"Doe, Jane","said ""hi""\nthen left"').rows).toEqual([
            ['name', 'note'],
            ['Doe, Jane', 'said "hi"\nthen left'],
        ])
    })

    it('ignores a trailing line break and a byte order mark', () => {
        expect(parseCsv('﻿a,b\n1,2\n').rows).toEqual([
            ['a', 'b'],
            ['1', '2'],
        ])
    })

    it('keeps empty fields', () => {
        expect(parseCsv('a,,c\n,,').rows).toEqual([
            ['a', '', 'c'],
            ['', '', ''],
        ])
    })

    it('stops at maxRows and says the rest was cut', () => {
        expect(parseCsv('h\n1\n2\n3', { maxRows: 2 })).toEqual({ rows: [['h'], ['1']], truncated: true })
        expect(parseCsv('h\n1\n', { maxRows: 2 })).toEqual({ rows: [['h'], ['1']], truncated: false })
    })

    it('handles a lone CR as a record end', () => {
        expect(parseCsv('a,b\r1,2').rows).toEqual([
            ['a', 'b'],
            ['1', '2'],
        ])
    })
})

describe('sniffDelimiter', () => {
    it('picks the delimiter that splits the header most', () => {
        expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';')
        expect(sniffDelimiter('a\tb\tc')).toBe('\t')
        expect(sniffDelimiter('a,b')).toBe(',')
    })

    it('ignores delimiters inside quotes', () => {
        expect(sniffDelimiter('"a;b;c",d,e\n')).toBe(',')
    })

    it('parses with the sniffed delimiter', () => {
        expect(parseCsv('a;b\n"1,5";2').rows).toEqual([
            ['a', 'b'],
            ['1,5', '2'],
        ])
    })
})

describe('numericColumns', () => {
    it('flags columns whose every filled cell is a number', () => {
        expect(numericColumns([
            ['Northwind', '$24,000', '12%'],
            ['Globex', '58500', ''],
            ['Initech', '1 200,50', 'n/a'],
        ])).toEqual([false, true, false])
    })

    it('reads money, percents and grouped thousands as numbers', () => {
        for (const cell of ['$24,000', '-3.5', '12%', '1.234,56', '€12', '4k']) expect(isNumericCell(cell)).toBe(true)
        for (const cell of ['', 'Q3', '2024-10-01', 'abc']) expect(isNumericCell(cell)).toBe(false)
    })
})
