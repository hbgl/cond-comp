# Conditional compilation

[![CI](https://github.com/hbgl/cond-comp/workflows/CI/badge.svg)](https://github.com/hbgl/cond-comp/actions/workflows/ci.yaml) [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/hbgl/cond-comp/blob/master/LICENSE)

This library allows you to alter JavaScript code through `if` statements that can be statically evaluated at build time.

## Example

File `source.js`:

```js
let value;
// #if FOO
value = 1;
// #elseif BAR
value = 2;
// #else
value = 3;
// #endif
console.log(value);
```

Build script:

```js
import { condComp } from "cond-comp";
import fs from "node:fs";

const sourceCode = await fs.promises.readFile("source.js", {
  encoding: "utf-8",
});

const compiledCode = await condComp(sourceCode, {
  FOO: true,
  BAR: true,
});

console.log(compiledCode);
```

Output:

```
let value;
value = 1;
console.log(value);

```

## Installation

```
npm install cond-comp
```

## Usage

```ts
function condComp(code: string, context: Record<string, any>): Promise<string>;
function condCompSync(code: string, context: Record<string, any>): string;
```

Coditional code sections can be expressed with special JavaScript comments:

- `// #if expression`
- `// #elseif expression`
- `// #else`
- `// #endif`

The keywords `#if`, `#elseif`, `#else` and `#endif` must appear at the beginning of the comment (ignoring whitespace). Here are some examples:

```js
// This is just a regular comment because #if does not appear at the beginning.

// #if 'This is a basic conditional.'
// #endif

//    #if 'This is a conditional with insignificant leading whitespace.'
//    #endif

// #if FOO
// You can put arbitrary text after #endif.
// #endif FOO
```

The `#if` and `#endif` expressions can be any valid JavaScript expression. Expressions are evaluated through [`vm.runInContext`](https://nodejs.org/api/vm.html#vmrunincontextcode-contextifiedobject-options) within the context that was passed to `condComp`.

Conditionals can of course be nested like they can in JavaScript:

```js
// #if FOO
console.log("foo");

// #if BAR
console.log("foo and bar");
// #endif

// #else
console.log("not foo");

// #if BAZ
console.log("not foo and baz");
// #endif

// #endif
```

## CLI

This library comes bundled with a console application that allows you to compile files from the command line.

```
npx cond-comp
```

```
Usage: cond-comp [options] <files...>

Conditionally compile JS code files with #if, #elseif, #else, #endif comments.
Currently the program can only modify files in place via the required option -i.

Arguments:
  files                input files

Options:
  -g --glob            treat input files as glob patterns
  -v, --var <vars...>  context variables, e.g. DEBUG or ENV=local
  -e, --env <file>     env file to use as the context (uses dotenv and dotenv-expand)
  --dry-run            do not modify files
  -i, --in-place       modify files in place
  -h, --help           display help for command
```

## Advanced Usage

### Async / Await

You can use `async` and `await` within your expressions.

```js
// #if await Promise.resolve(true)
console.log("Yep.");
// #endif

// #if await (async () => true)()
console.log("Works.");
// #endif
```

Please note that `async` and `await` are not supported when using `condCompSync`.

### Mutable state

All expressions are executed in a single [context](https://v8.dev/docs/embed#contexts). Should your expressions mutate state, then the changes will be visible to subsequent expressions, which this contrived example illustrates:

```js
// Assign false to a.
// #if a = false
console.log("Nope.");
// #endif

// #if a
console.log("Still nope.");
// #endif

// Assign true to a.
// #if a = true
console.log("Yep.");
// #endif

// #if a
console.log("Sure.");
// #endif
```

Mutating the context within your expressions will also affect to the context object that was passed to `condComp`:

```js
const code = `// #if a = 1
// #endif`;

const context = { a: 0 };
await condComp(code, context);
console.assert(context.a === 1);
```

### Multi-line comments

You can express conditionals using multi-line comments (C-style). However, please note that `#if` and `#elseif` expressions are still single-line only. Here are some examples:

```js
/* #if 'C-style comments also work.' */
/* #endif */

/**
 * #if 'You can place the keyword on a new line. The single leading asterisk is ignored.'
 */
/**
 * #endif
 */

/**
 * #if 'The expression is single-line only.'
 * && false && 'This line is not part of the expression.'
 */
/**
 * #endif
 */

/**
 * #if 'Only the first keyword in a comment is recognized.'
 * #if This is ignored.
 * #endif This is also ignored.
 */
/**
 * #endif
 */

/**
 * You can put a comment above the keyword.
 * #if true
 * And also below it.
 */
/**
 * #endif
 */
```

## License

MIT  
https://opensource.org/licenses/mit-license.php
