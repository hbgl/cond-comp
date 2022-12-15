import test, { ExecutionContext } from 'ava';
import { condComp, CondCompEvalError, CondCompParseError, condCompSync } from './index';

/**
 * Square brackets symbolize whether the expression of the branch
 * evaluates to true. For example, '[if] else' means that the if
 * branch's expression is true.
 */

test('example', async t => {
    const code =
        `// This is a more complicated example.
let val = 1;

// #if FOO && BAR
    val = 2;

// #elseif FOO
    val = 3;
    // #if Date.now() >= 0
        val *= 2;
        // #if [1, 2, 3].filter(i => i > 2).length > 0
            val += 13;
            console.log(val);
        // #endif
    // #endif

    // #if Array.isArray(123)
        val += 17;
    // #elseif Math.random() >= 0
        val += 9;
    // #endif
// #elseif BAR
    val = 4;
// #else
    val = 5;
// #endif

val -= 15; // #if true
val += 9; // #endif
`;

    const compiledCode = await condComp(code, {
        FOO: true,
        BAR: false,
    });
    t.is(compiledCode,
        `// This is a more complicated example.
let val = 1;

    val = 3;
        val *= 2;
            val += 13;
            console.log(val);

        val += 9;

val -= 15;
val += 9;
`);
});

for (const [name, [context, expectedCode]] of Object.entries({
    '[if]': [{ A: true }, '1\n2\n3'],
    'if': [{ A: false }, '1\n3'],
})) {
    test(name, async t => {
        const code =
            `1
// #if A
2
// #endif
3`

        const compiledCode = await condComp(code, context as Record<string, any>);
        t.is(compiledCode, expectedCode as string);
    });
}

for (const [name, [context, expectedCode]] of Object.entries({
    '[if] else': [{ A: true }, '1\n2\n4'],
    'if else': [{ A: false }, '1\n3\n4'],
})) {
    test(name, async t => {
        const code =
            `1
// #if A
2
// #else
3
// #endif
4`

        const compiledCode = await condComp(code, context as Record<string, any>);
        t.is(compiledCode, expectedCode as string);
    });
}

for (const [key, [context, expectedCode]] of Object.entries({
    '[if] elseif else': [{ A: true, B: false }, '1\n2\n5'],
    'if [elseif] else': [{ A: false, B: true }, '1\n3\n5'],
    '[if] [elseif] else': [{ A: true, B: true }, '1\n2\n5'],
    'if elseif else': [{ A: false, B: false }, '1\n4\n5'],
})) {
    test(key, async t => {
        const code =
            `1
// #if A
2
// #elseif B
3
// #else
4
// #endif
5`
        const compiledCode = await condComp(code, context as Record<string, any>);
        t.is(compiledCode, expectedCode as string);
    });
}

for (const [key, [context, expectedCode]] of Object.entries({
    '[if] elseif elseif else': [{ A: true, B: false, C: false }, '1\n2\n6'],
    '[if] [elseif] elseif else': [{ A: true, B: true, C: false }, '1\n2\n6'],
    '[if] [elseif] [elseif] else': [{ A: true, B: true, C: true }, '1\n2\n6'],
    'if [elseif] elseif else': [{ A: false, B: true, C: false }, '1\n3\n6'],
    'if [elseif] [elseif] else': [{ A: false, B: true, C: true }, '1\n3\n6'],
    'if elseif [elseif] else': [{ A: false, B: false, C: true }, '1\n4\n6'],
    'if elseif elseif else': [{ A: false, B: false, C: false }, '1\n5\n6'],
})) {
    test(key, async t => {
        const code =
            `1
// #if A
2
// #elseif B
3
// #elseif C
4
// #else
5
// #endif
6`
        const compiledCode = await condComp(code, context as Record<string, any>);
        t.is(compiledCode, expectedCode as string);
    });
}

for (const [key, [context, expectedCode]] of Object.entries({
    '[if]': [{ A: true }, '1\n2'],
    'if': [{ A: false }, '2'],
})) {
    test(`${key} at start`, async t => {
        const code =
            `// #if A
1
// #endif
2`;

        const compiledCode = await condComp(code, context as Record<string, any>);
        t.is(compiledCode, expectedCode as string);
    });
}

for (const [key, [context, expectedCode]] of Object.entries({
    '[if]': [{ A: true }, '1\n2\n'],
    'if': [{ A: false }, '1\n'],
})) {
    test(`${key} at end`, async t => {
        const code =
            `1
// #if A
2
// #endif`;

        const compiledCode = await condComp(code, context as Record<string, any>);
        t.is(compiledCode, expectedCode as string);
    });
}

for (const [key, [context, expectedCode]] of Object.entries({
    '[if]': [{ A: true }, '1\n'],
    'if': [{ A: false }, ''],
})) {
    test(`${key} from start to end`, async t => {
        const code =
            `// #if A
1
// #endif`;

        const compiledCode = await condComp(code, context as Record<string, any>);
        t.is(compiledCode, expectedCode as string);
    });
}

for (const [key, [context, expectedCode]] of Object.entries({
    '[if] else': [{ A: true }, '1\n'],
    'if else': [{ A: false }, '2\n'],
})) {
    test(`${key} from start to end`, async t => {
        const code =
            `// #if A
1
// #else
2
// #endif`;

        const compiledCode = await condComp(code, context as Record<string, any>);
        t.is(compiledCode, expectedCode as string);
    });
}

for (const [name, [context, expectedCode]] of Object.entries({
    '[if] -> [if]': [{ A: true, B: true }, '1\n2\n3\n'],
    '[if] -> if': [{ A: true, B: false }, '1\n3\n'],
    'if -> [if]': [{ A: false, B: true }, ''],
    'if -> if': [{ A: false, B: false }, ''],
})) {
    test(`nested ${name}`, async t => {
        const code =
            `// #if A
1
// #if B
2
// #endif
3
// #endif`

        const compiledCode = await condComp(code, context as Record<string, any>);
        t.is(compiledCode, expectedCode as string);
    });
}

for (const [name, [context, expectedCode]] of Object.entries({
    '[if] -> [if] else': [{ A: true, B: true }, '1\n2\n4\n'],
    '[if] -> if else': [{ A: true, B: false }, '1\n3\n4\n'],
})) {
    test(`nested ${name}`, async t => {
        const code =
            `// #if A
1
// #if B
2
// #else
3
// #endif
4
// #endif`

        const compiledCode = await condComp(code, context as Record<string, any>);
        t.is(compiledCode, expectedCode as string);
    });
}

for (const [name, [context, expectedCode]] of Object.entries({
    '[if] -> [if] elseif else': [{ A: true, B: true, C: false }, '1\n2\n5\n'],
    '[if] -> [if] [elseif] else': [{ A: true, B: true, C: true }, '1\n2\n5\n'],
    '[if] -> if [elseif] else': [{ A: true, B: false, C: true }, '1\n3\n5\n'],
    '[if] -> if elseif else': [{ A: true, B: false, C: false }, '1\n4\n5\n'],
})) {
    test(`nested ${name}`, async t => {
        const code =
            `// #if A
1
// #if B
2
// #elseif C
3
// #else
4
// #endif
5
// #endif`

        const compiledCode = await condComp(code, context as Record<string, any>);
        t.is(compiledCode, expectedCode as string);
    });
}

test('very deeply nested if', async t => {
    const code =
        `// #if true
// #if true
// #if true
// #if true
// #if true
// #if true
// #if A
1
// #endif
// #endif
// #endif
// #endif
// #endif
// #endif
// #endif`;

    const compiledCode = await condComp(code, { A: true });

    t.is(compiledCode, '1\n');
});

test('very deeply nested elseif', async t => {
    const code =
        `// #if false
// #elseif true
// #if false
// #elseif true
// #if false
// #elseif true
// #if false
// #elseif true
// #if false
// #elseif true
// #if false
// #elseif true
// #if false
// #elseif true
1
// #endif
// #endif
// #endif
// #endif
// #endif
// #endif
// #endif`;

    const compiledCode = await condComp(code, { A: true });

    t.is(compiledCode, '1\n');
});

test('await in if expression', async t => {
    const code =
        `// #if await A
1
// #endif`;

    const context = {
        A: new Promise<boolean>(resolve => {
            setTimeout(() => resolve(true), 100);
        }),
    };
    const compiledCode = await condComp(code, context);
    t.is(compiledCode, '1\n');
});

test('c-style comment single line', async t => {
    const code =
        `/* #if true */
1
/* #endif */`;

    const compiledCode = await condComp(code, {});
    t.is(compiledCode, '1\n');
});

test('c-style comment multiline', async t => {
    const code =
        `/**
 * #if true
 */
1
/**
 * #endif
 */`;

    const compiledCode = await condComp(code, {});
    t.is(compiledCode, '1\n');
});

test('c-style comment with indentation', async t => {
    const code =
        `   /**
     * #if true
     */
    1
    /**
     * #endif
     */`;

    const compiledCode = await condComp(code, {});
    t.is(compiledCode, '    1\n');
});

test('c-style comment only works on single line', async t => {
    const code =
        `
/**
  * #if true
  * && false
  */
    1
/**
  * #endif
  */`;

    const compiledCode = await condComp(code, {});
    t.is(compiledCode, '    1\n');
});

test('sync', t => {
    const code =
        `// #if A
1
// #endif
`;

    const compiledCode = condCompSync(code, { A: true });
    t.is(compiledCode, '1\n');
});

test('mutable state in if expressions', async t => {
    const code =
        `// #if A
1
// #endif
// #if A = true
2
// #endif
// #if A
3
// #endif`;

    const compiledCode = await condComp(code, { A: false });
    t.is(compiledCode, '2\n3\n');
});

test('mutate context', async t => {
    const code =
        `// #if A = 2
1
// #endif`;

    const context = { A: 1 };
    await condComp(code, context);
    t.is(context.A, 2);
});

test('if expression exception', async t => {
    const code =
        `// #if (() => { throw new Error(); })()
1
// #endif`;

    const error = await condCompCatchEval(t, code, {});
    t.is(error.line, 1);
    t.is(error.column, 0);
});

test('elseif expression exception', async t => {
    const code =
        `// #if false
1
// #elseif (() => { throw new Error(); })()
2
// #endif`;

    const error = await condCompCatchEval(t, code, {});
    t.is(error.line, 3);
    t.is(error.column, 0);
});

test('multiple exceptions', async t => {
    const code =
        `// #if (() => { throw new Error(); })()
1
// #endif

// #if (() => { throw new Error(); })()
2
// #endif`;

    const error = await condCompCatchEval(t, code, {});
    t.is(error.line, 1);
    t.is(error.column, 0);
});

test('invalid expression code', t => {
    const code =
        `// #if await Promise.resolve(1)
1
// #endif`;

    const error = condCompCatchEvalSync(t, code, {});

    t.is(error.line, 0);
    t.is(error.column, 0);
});

test('duplicate else', async t => {
    const code =
        `// #if A
1
// #else
2
// #else
3
// #endif`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const entry = error.entries[0];
    t.is(entry.type, 'parse');
    t.is(entry.subtype, 'duplicate_else');
    t.is(entry.line, 5);
    t.is(entry.column, 0);
});

test('elseif without if', async t => {
    const code =
        `// #elseif A
1
// #endif`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const entry = error.entries[0];
    t.is(entry.type, 'parse');
    t.is(entry.subtype, 'elseif_without_if');
    t.is(entry.line, 1)
    t.is(entry.column, 0);
});

test('elseif without if and without endif', async t => {
    const code =
        `// #elseif A
1`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 2);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'elseif_without_if');
    t.is(error1.line, 1)
    t.is(error1.column, 0);

    const error2 = error.entries[1];
    t.is(error2.type, 'parse');
    t.is(error2.subtype, 'missing_endif');
    t.is(error2.line, 1)
    t.is(error2.column, 0);
});

test('many elseif without if', async t => {
    const code =
        `// #elseif A
1
// #elseif B
2
// #endif`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'elseif_without_if');
    t.is(error1.line, 1)
    t.is(error1.column, 0);
});

test('elseif and else without if', async t => {
    const code =
        `// #elseif A
1
// #else
2
// #endif`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'elseif_without_if');
    t.is(error1.line, 1)
    t.is(error1.column, 0);
});

test('else without if', async t => {
    const code =
        `// #else
1
// #endif`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'else_without_if');
    t.is(error1.line, 1)
    t.is(error1.column, 0);
});

test('else without if and without endif', async t => {
    const code =
        `// #else
1`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 2);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'else_without_if');
    t.is(error1.line, 1)
    t.is(error1.column, 0);

    const error2 = error.entries[1];
    t.is(error2.type, 'parse');
    t.is(error2.subtype, 'missing_endif');
    t.is(error2.line, 1)
    t.is(error2.column, 0);
});

test('endif without if', async t => {
    const code =
        `// #endif`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'endif_without_if');
    t.is(error1.line, 1)
    t.is(error1.column, 0);
});

test('if else missing endif', async t => {
    const code =
        `// #if A
1
// #else
2`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'missing_endif');
    t.is(error1.line, 1)
    t.is(error1.column, 0);
});

test('if elseif missing endif', async t => {
    const code =
        `// #if A
1
// #elseif B
2`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'missing_endif');
    t.is(error1.line, 1)
    t.is(error1.column, 0);
});

test('if missing endif outer', async t => {
    const code =
        `1
// #if A
2
// #if B
3
//#endif
4`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'missing_endif');
    t.is(error1.line, 2)
    t.is(error1.column, 0);
});

test('if missing endif more than once', async t => {
    const code =
        `1
// #if A
2
// #if B
3`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 2);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'missing_endif');
    t.is(error1.line, 2)
    t.is(error1.column, 0);

    const error2 = error.entries[1];
    t.is(error2.type, 'parse');
    t.is(error2.subtype, 'missing_endif');
    t.is(error2.line, 4)
    t.is(error2.column, 0);
});

test('if missing endif', async t => {
    const code =
        `// #if A
1`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'missing_endif');
    t.is(error1.line, 1)
    t.is(error1.column, 0);
});

test('if without expression', async t => {
    const code =
        `// #if
// #endif`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'invalid_expression');
    t.is(error1.line, 1)
    t.is(error1.column, 0);
});

test('if with invalid expression', async t => {
    const code =
        `// #if while (false) {}
// #endif`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'invalid_expression');
    t.is(error1.line, 1)
    t.is(error1.column, 0);
});

test('if with more than one expression', async t => {
    const code =
        `1
// #if A; B;
2
// #endif
3`;

    const error = await condCompCatchParse(t, code, {});
    t.is(error.entries.length, 1);

    const error1 = error.entries[0];
    t.is(error1.type, 'parse');
    t.is(error1.subtype, 'invalid_expression');
    t.is(error1.line, 2)
    t.is(error1.column, 0);
});

test('whitespace slurp simple indented', async t => {
    const code =
        `    // #if true
1
    // #endif`

    const compiledCode = await condComp(code, {});
    t.is(compiledCode, '1\n');
});

test('whitespace slurp endif on same line', async t => {
    const code =
        `// #if true
1    // #endif`

    const compiledCode = await condComp(code, {});
    t.is(compiledCode, '1');
});

test('whitespace slurp nested', async t => {
    const code =
        `    // #if true
        // #if true
            1
        // #endif
        // #if false
            2
        // #elseif true
            3
        // #endif
    // #endif`

    const compiledCode = await condComp(code, {});
    t.is(compiledCode, '            1\n            3\n');
});

test('whitespace slurp charactes', async t => {
    const code =
        `1\u{0009}\u{000B}\u{000C}\u{0020}\u{00A0}// #if true
2\u{1680}\u{2000}\u{2001}\u{2002}// #endif
    3\u{2003}\u{2004}\u{2005}\u{2006}// #if true
    4\u{2007}\u{2008}\u{2009}\u{200A}\u{202F}\u{205F}\u{3000}\u{FEFF}// #endif`;

    const compiledCode = await condComp(code, {});
    t.is(compiledCode, '1\n2\n    3\n    4');
});

test('slurp newlines', async t => {
    const code =
        `// #if true
1
// #endif

    // #if true
    2
4711    // #endif
5913 // #if true
4
// #endif
`;

    const compiledCode = await condComp(code, {});

    const expectedCode =
        `1

    2
4711
5913
4
`;
    t.is(compiledCode, expectedCode);
});

async function condCompCatchParse<T>(t: ExecutionContext<T>, code: string, context: Record<string, any>) {
    let error: any;
    try {
        await condComp(code, {});
    } catch (e) {
        error = e;
    }

    if (!t.assert(error instanceof CondCompParseError)) {
        throw new Error();
    }
    return error as CondCompParseError;
}

async function condCompCatchEval<T>(t: ExecutionContext<T>, code: string, context: Record<string, any>) {
    let error: any;
    try {
        await condComp(code, {});
    } catch (e) {
        error = e;
    }

    if (!t.assert(error instanceof CondCompEvalError)) {
        throw new Error();
    }
    return error as CondCompEvalError;
}

function condCompCatchEvalSync<T>(t: ExecutionContext<T>, code: string, context: Record<string, any>) {
    let error: any;
    try {
        condCompSync(code, {});
    } catch (e) {
        error = e;
    }

    if (!t.assert(error instanceof CondCompEvalError)) {
        throw new Error();
    }
    return error as CondCompEvalError;
}