import * as acorn from 'acorn';
import vm from 'node:vm';

export async function condComp(code: string, context: Record<string, any>) {
    const ifBlocks = parse(code);

    await evaluateIfs(ifBlocks, context);

    const resultCode = apply(code, ifBlocks);
    return resultCode;
}

export function condCompSync(code: string, context: Record<string, any>) {
    const ifBlocks = parse(code);

    evaluateIfsSync(ifBlocks, context);

    const resultCode = apply(code, ifBlocks);
    return resultCode;
}

export class CondCompError extends Error {
    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, CondCompError.prototype);
    }
}

export class CondCompParseError extends CondCompError {
    public entries: CondCompErrorEntry[];

    constructor(message: string, entries?: CondCompErrorEntry[]) {
        super(message);
        Object.setPrototypeOf(this, CondCompParseError.prototype);
        this.entries = entries ?? [];
    }
}

export class CondCompEvalError extends CondCompError {
    public line: number;
    public column: number;
    public error: any;

    constructor(message: string, error: EvaluationError) {
        super(message);
        Object.setPrototypeOf(this, CondCompEvalError.prototype);
        this.line = error.line;
        this.column = error.column;
        this.error = error.cause;
    }
}

interface Endif {
    start: number,
    end: number,
    line: number,
    column: number,
}

interface ElseBlock {
    type: 'else',
    start: number,
    end: number,
    line: number,
    column: number,
    children?: IfBlock[],
}

interface ElseIfBlock {
    type: 'elseif',
    start: number,
    end: number,
    line: number,
    column: number,
    expression: string,
    children?: IfBlock[],
}

interface IfBlock {
    type: 'if',
    start: number,
    end: number,
    line: number,
    column: number,
    expression: string,
    takenBranch?: number,
    children?: IfBlock[],
    elseIfs?: ElseIfBlock[],
    else?: ElseBlock,
    endif: Endif,
    dummy: boolean,
}

type Block = IfBlock | ElseIfBlock | ElseBlock;

export interface CondCompErrorEntry {
    type: 'parse' | 'evaluation',
    subtype?: 'invalid_expression' | 'missing_endif' | 'elseif_without_if' | 'elseif_after_else' | 'else_without_if' | 'duplicate_else' | 'endif_without_if',
    message: string,
    line: number,
    column: number,
    error?: Error,
}

interface EvaluationError {
    cause: any,
    line: number,
    column: number,
}

interface EvaluationResultEntry {
    // 0: if branch hit
    // 1 - x: elseif branch hit
    // -1: else branch hit
    branch: number,
    children?: EvaluationResultEntry[],
}

type EvaluationResult = EvaluationResultEntry[] | EvaluationError;

const ecmaVersion: acorn.ecmaVersion = 2020;

type ParseExpressionResult = {
    code: string,
    error: undefined,
} | { error: Error };

function parse(code: string) {
    const toplevel: IfBlock[] = [];
    const ifStack: IfBlock[] = [];
    const scopeStack: Block[] = [];
    const errors: CondCompErrorEntry[] = [];

    const tokenizer = acorn.tokenizer(code, {
        ecmaVersion,
        locations: true,
        onComment: (isBlock: boolean, text: string, start: number, end: number, startLoc?: acorn.Position, endLoc?: acorn.Position) => {
            let match: RegExpExecArray | null = null;
            if (isBlock) {
                match = /^\s*\*?\s*#(if|elseif|else|endif)(?:$|\s+$|\s+(.+)$)/m.exec(text);
            } else {
                match = /^\s*#(if|elseif|else|endif)(?:$|\s+$|\s+(.+)$)/.exec(text);
            }

            if (match === null) {
                return;
            }

            // Include new line in end position.
            // end += getCommentNewLineLength(code, end);

            const pushIf = (ifBlock: IfBlock) => {
                const scope = scopeStack[scopeStack.length - 1];
                if (scope !== undefined) {
                    scope.children = scope.children ?? [];
                    scope.children.push(ifBlock);
                }
                scopeStack.push(ifBlock);
                ifStack.push(ifBlock);
            };

            const tag = match[1];
            const line = startLoc!.line;
            const column = startLoc!.column;
            const rawExpression = match[2] ?? '';

            const setExpression = (exprCode: string, block: IfBlock | ElseIfBlock) => {
                if (rawExpression === '') {
                    errors.push({
                        type: 'parse',
                        subtype: 'invalid_expression',
                        message: `Found #${block.type} without expression.`,
                        line,
                        column,
                    });
                    return;
                }
                const expressionResult = parseExpression(rawExpression);
                if (expressionResult.error !== undefined) {
                    errors.push({
                        type: 'parse',
                        subtype: 'invalid_expression',
                        message: expressionResult.error.message,
                        line,
                        column,
                    });
                    return;
                }
                block.expression = expressionResult.code;
            };

            // Whenever a missing #if is detected, this dummy if block
            // is inserted to continue parsing. This will also prevent
            // subsequent "without_if" errors.
            const makeDummyIf = (): IfBlock => ({
                type: 'if',
                expression: '',
                start,
                end,
                line,
                column,
                takenBranch: undefined,
                children: undefined,
                elseIfs: undefined,
                else: undefined,
                endif: { start: -1, end: -1, line: -1, column: -1 },
                dummy: true,
            });

            // Find #if tag.
            if (tag === 'if') {
                const ifBlock: IfBlock = {
                    type: 'if',
                    expression: '',
                    start,
                    end,
                    line,
                    column,
                    takenBranch: undefined,
                    children: undefined,
                    elseIfs: undefined,
                    else: undefined,
                    endif: { start: -1, end: -1, line: -1, column: -1 },
                    dummy: false,
                };
                setExpression(rawExpression, ifBlock);
                pushIf(ifBlock);
                return;
            }

            // Find #elseif tag.
            if (tag === 'elseif') {
                const elseIfBlock: ElseIfBlock = {
                    type: 'elseif',
                    expression: '',
                    start,
                    end,
                    line,
                    column,
                    children: undefined,
                };
                setExpression(rawExpression, elseIfBlock);

                let currentIfBlock = ifStack[ifStack.length - 1];
                if (currentIfBlock === undefined) {
                    errors.push({
                        type: 'parse',
                        subtype: 'elseif_without_if',
                        message: 'Found #elseif without matching #if.',
                        line,
                        column,
                    });
                    currentIfBlock = makeDummyIf();
                    pushIf(currentIfBlock);
                }
                if (currentIfBlock.else !== undefined) {
                    errors.push({
                        type: 'parse',
                        subtype: 'elseif_after_else',
                        message: 'Found invalid #elseif after #else.',
                        line,
                        column,
                    });
                }

                // Push elseif onto parent if.
                currentIfBlock.elseIfs = currentIfBlock.elseIfs ?? [];
                currentIfBlock.elseIfs.push(elseIfBlock);

                // Replace #if or #elseif scope with new #elseif.
                scopeStack[scopeStack.length - 1] = elseIfBlock;

                return;
            }

            // Find #else tag.
            if (tag === 'else') {
                const elseBlock: ElseBlock = {
                    type: 'else',
                    start,
                    end,
                    line,
                    column,
                    children: undefined,
                };

                let currentIfBlock = ifStack[ifStack.length - 1];
                if (currentIfBlock === undefined) {
                    errors.push({
                        type: 'parse',
                        subtype: 'else_without_if',
                        message: "Found #else without matching #if or #elseif.",
                        line,
                        column,
                    });
                    currentIfBlock = makeDummyIf();
                    pushIf(currentIfBlock);
                }
                if (currentIfBlock.else !== undefined) {
                    errors.push({
                        type: 'parse',
                        subtype: 'duplicate_else',
                        message: "Found duplicate #else.",
                        line,
                        column,
                    });
                }

                // Set else in parent #if.
                currentIfBlock.else = elseBlock;

                // Replace #is or #elseif scope with #else.
                scopeStack[scopeStack.length - 1] = elseBlock;

                return;
            }

            // Find #endif tag.
            if (tag === 'endif') {
                const currentIfBlock = ifStack.pop();
                if (currentIfBlock === undefined) {
                    errors.push({
                        type: 'parse',
                        subtype: 'endif_without_if',
                        message: "Found #endif without matching #if,#elseif, or #else.",
                        line,
                        column,
                    });
                    return;
                }
                // Set endif position.
                currentIfBlock.endif = {
                    start,
                    end,
                    line,
                    column,
                };

                // Remove current #if, #elseif or #else scope.
                scopeStack.pop();
                if (scopeStack.length === 0) {
                    toplevel.push(currentIfBlock);
                }
            }
        }
    });

    for (let _ of tokenizer) { }

    for (const ifBlock of ifStack) {
        errors.push({
            type: 'parse',
            subtype: 'missing_endif',
            message: 'Found #if without matching #elseif.',
            line: ifBlock.line,
            column: ifBlock.column,
        });
    }

    if (errors.length > 0) {
        throw new CondCompParseError("Encountered one or more errors during parsing.", errors);
    }

    return toplevel;
}

function parseExpression(exprCode: string): ParseExpressionResult {
    let ast: acorn.Node | undefined;
    try {
        ast = acorn.parse(exprCode, {
            ecmaVersion,
            allowAwaitOutsideFunction: true,
        });
    } catch (e) {
        return {
            error: e as Error,
        }
    }

    const body = (ast as any).body as acorn.Node[];
    const expr = body[0] ?? undefined;

    // First check if we got an expression or not.
    if (expr && expr.type !== 'ExpressionStatement') {
        return {
            error: new Error(`Expected an expression, found ${expr.type}.`),
        };
    }

    // Then check if we got more than just one expression.
    if (body.length !== 1) {
        return {
            error: new Error('Expected exactly one expression.'),
        };
    }

    return {
        code: exprCode.slice(expr.start, expr.end),
        error: undefined,
    }
}

function compileIf(ifBlock: IfBlock, sync: boolean): string {
    function compileChildren(ifBlock: Block) {
        if (ifBlock.children === undefined) {
            return '';
        }
        return `children: [
            ${ifBlock.children.map(ifBlock => compileIf(ifBlock, sync)).join(',\n')}
        ],`;
    }

    return `${sync ? '' : 'await'} (${sync ? '' : 'async'} () => {
        try {
            if (${ifBlock.expression}) {
                return {
                    branch: 0,
                    ${compileChildren(ifBlock)}
                };
            }
        } catch (e) {
            throw {
                cause: e,
                line: ${ifBlock.line},
                column: ${ifBlock.column},
            };
        }
        ${ifBlock.elseIfs === undefined ? '' : ifBlock.elseIfs.map((ifBlock, index) => {
        return `try {
                if (${ifBlock.expression}) {
                    return {
                        branch: ${index + 1},
                        ${compileChildren(ifBlock)}
                    };
                }
            } catch (e) {
                throw {
                    cause: e,
                    line: ${ifBlock.line},
                    column: ${ifBlock.column},
                };
            }`;
    }).join('\n')}
        return {
            branch: -1,
            ${ifBlock.else === undefined ? '' : compileChildren(ifBlock.else)}
        };
    })()`;
}

function compileIfs(ifBlocks: IfBlock[], sync: boolean) {
    return `(${sync ? '' : 'async'} () => {
        try {
            return [
                ${ifBlocks.map(ifBlock => compileIf(ifBlock, sync)).join(',\n')}
            ];
        } catch (e) {
            return e;
        }
    })()`;
}

function contextify(context: Object) {
    if (vm.isContext(context)) {
        return context;
    }
    return vm.createContext(context);
}

async function evaluateIfs(ifBlocks: IfBlock[], context: Record<string, any>) {
    const code = compileIfs(ifBlocks, false);
    let result: EvaluationResult;
    try {
        result = (await vm.runInContext(code, contextify(context))) as EvaluationResult;
    } catch (e) {
        throw makeEvaluationError({
            cause: e,
            line: 0,
            column: 0,
        });
    }
    setEvaluationResults(ifBlocks, result);
}

function evaluateIfsSync(ifBlocks: IfBlock[], context: Record<string, any>) {
    const code = compileIfs(ifBlocks, true);
    let result: EvaluationResult;
    try {
        result = vm.runInContext(code, contextify(context)) as EvaluationResult;
    } catch (e) {
        throw makeEvaluationError({
            cause: e,
            line: 0,
            column: 0,
        });
    }
    setEvaluationResults(ifBlocks, result);
}

function setEvaluationResults(ifBlocks: IfBlock[], result: EvaluationResult) {
    if (!Array.isArray(result)) {
        throw makeEvaluationError(result);
    }
    for (let i = 0; i < result.length; i++) {
        const ifBlock = ifBlocks[i];
        const { branch, children: childrenResults } = result[i];
        ifBlock.takenBranch = branch;

        if (childrenResults !== undefined) {
            if (branch === 0) {
                setEvaluationResults(ifBlock.children!, childrenResults);
            } else if (branch > 0) {
                const elseIf = ifBlock.elseIfs![branch - 1];
                setEvaluationResults(elseIf.children!, childrenResults);
            } else if (ifBlock.else) {
                setEvaluationResults(ifBlock.else.children!, childrenResults);
            }
        }
    }
}

function makeEvaluationError(error: EvaluationError) {
    let message = `Evaluation error at line ${error.line} and column ${error.column}`;
    if (error.cause.message) {
        message += `: ${error.cause.message}`;
    }
    return new CondCompEvalError(message, error);
}

interface Slice {
    start: number,
    end: number,
}
class Cuts {
    // The (0,0) sentinel simplifies the code.
    public slices: Slice[] = [{ start: 0, end: 0 }];

    public add(start: number, end: number) {
        const prevCut = this.slices[this.slices.length - 1];
        if (prevCut.end === start) {
            prevCut.end = end;
        } else {
            this.slices.push({ start, end });
        }
    }

    public isEmpty() {
        return this.slices.length === 1 && this.slices[0].end === 0;
    }
}

function apply(code: string, ifBlocks: IfBlock[]) {
    const cuts = new Cuts();
    makeCuts(ifBlocks, cuts);

    if (cuts.isEmpty()) {
        return code;
    }

    let resultCode = '';
    let pos = 0;
    for (const slice of cuts.slices) {
        const end = slurpAllWhitespaceLeft(code, slice.start);

        resultCode += code.slice(pos, end);
        pos = slice.end;

        if (isEmptyLine(code, end)) {
            pos = slurpSingleNewLineRight(code, pos);
        }
    }
    resultCode += code.slice(pos);
    return resultCode;
}

/**
 * Create a list of code sections to remove according
 * to the evaluated branches.
 * @param ifBlocks 
 * @param cuts 
 */
function makeCuts(ifBlocks: IfBlock[], cuts: Cuts) {
    for (const ifBlock of ifBlocks) {
        const takenBranch = ifBlock.takenBranch!;

        if (takenBranch === 0) {
            // Cut #if comment.
            cuts.add(ifBlock.start, ifBlock.end);

            if (ifBlock.children) {
                makeCuts(ifBlock.children, cuts);
            }

            // Cut trailing #elseif, #else and #endif comments.
            let start = 0;
            if (ifBlock.elseIfs) {
                start = ifBlock.elseIfs[0].start;
            } else if (ifBlock.else) {
                start = ifBlock.else.start;
            } else {
                start = ifBlock.endif.start;
            }
            cuts.add(start, ifBlock.endif.end);
        } else if (takenBranch >= 1) {
            const elseifBlock = ifBlock.elseIfs![takenBranch - 1];

            // Cut leading #if and #elseif comments.
            cuts.add(ifBlock.start, elseifBlock.end);

            if (elseifBlock.children) {
                makeCuts(elseifBlock.children, cuts);
            }

            // Cut trailing #elseif, #else and #endif comments.
            let start = 0;
            if (ifBlock.elseIfs!.length > takenBranch) {
                start = ifBlock.elseIfs![takenBranch].start;
            } else if (ifBlock.else) {
                start = ifBlock.else.start;
            } else {
                start = ifBlock.endif.start;
            }
            cuts.add(start, ifBlock.endif.end);
        } else if (ifBlock.else) {
            // Cut leading #if and #elseif comments.
            cuts.add(ifBlock.start, ifBlock.else.end);

            if (ifBlock.else.children) {
                makeCuts(ifBlock.else.children, cuts);
            }

            // Cut #endif comment.
            cuts.add(ifBlock.endif.start, ifBlock.endif.end);
        } else {
            // Cut everything.
            cuts.add(ifBlock.start, ifBlock.endif.end);
        }
    }
}

function isEmptyLine(str: string, end: number) {
    return end === 0 || isNewLineChar(str.charCodeAt(end - 1));
}

function slurpSingleNewLineRight(str: string, pos: number) {
    // See https://262.ecma-international.org/13.0/#prod-LineTerminatorSequence
    const c0 = str.codePointAt(pos);
    if (c0 === 0x000A || c0 === 0x2028 || c0 === 0x2029) {
        return pos + 1;
    }
    if (c0 === 0x000D) {
        const c1 = str.codePointAt(pos + 1);
        if (c1 === 0x000A) {
            return pos + 2;
        }
    }
    return pos;
}

function isNewLineChar(charCode: number) {
    return charCode === 0x00A || charCode === 0x000D || charCode === 0x2028 || charCode === 0x2028;
}

function slurpAllWhitespaceLeft(str: string, end: number) {
    const whitespace = [
        0x0020, 0x0009, 0x000B, 0x000C, 0x00A0,
        0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
        0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
        0x2009, 0x200A, 0x202F, 0x205F, 0x3000,
        0xFEFF,
    ];

    for (; ;) {
        const prev = end - 1;
        if (prev < 0) {
            break;
        }
        const charCode = str.charCodeAt(prev);
        if (!whitespace.includes(charCode)) {
            break;
        }
        end = prev;
    }
    return end;
}