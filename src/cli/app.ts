import { Command } from 'commander';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import nodeFs from 'node:fs';
import nodePath from 'node:path';
import glob from 'glob-promise';
import { condComp } from '../index';

/** @internal */
export interface MainOptions {
    fs?: any,
    argv?: readonly string[],
}

/** @internal */
export interface ProgramContext {
    command: Command,
    fs: any,
}

/** @internal */
export async function run(options?: MainOptions) {
    options = options ?? {};
    const command = makeCommand();
    command.parse(options.argv);
    const prog = {
        command,
        fs: options.fs ?? nodeFs,
    };
    const context = await createContext(prog);
    const paths = await readCodeFilePaths(prog);
    await compile(prog, paths, context);
}

/** @internal */
export function makeCommand() {
    return new Command()
        .name('cond-comp')
        .description('Conditionally compile JS code files with #if, #elseif, #else, #endif comments.\nCurrently the program can only modify files in place via the required option -i.')
        .argument('<files...>', 'input files')
        .option('-g --glob', 'treat input files as glob patterns')
        .option('-v, --var <vars...>', 'context variables, e.g. DEBUG or ENV=local')
        .option('-e, --env <file>', 'env file to use as the context (uses dotenv and dotenv-expand)')
        .option('--dry-run', 'do not modify files')
        .requiredOption('-i, --in-place', 'modify files in place')
        .showHelpAfterError();
}

/** @internal */
export async function compile(prog: ProgramContext, paths: string[], context: Context) {
    const { command, fs } = prog;
    const dryRun = command.opts().dryRun;
    for (const path of paths) {
        const inputCode = await fs.promises.readFile(path, { encoding: 'utf-8' });
        const outputCode = await condComp(inputCode, context);
        if (!dryRun) {
            await fs.promises.writeFile(path, outputCode);
        }
        console.error(`done    ${path}`);
    }
}

/** @internal */
export async function readCodeFilePaths(prog: ProgramContext) {
    const { command, fs } = prog;
    const paths = new Set<string>();
    const useGlob = command.opts().glob;
    const argFiles = command.args;
    for (const file of argFiles) {
        if (useGlob) {
            const globPaths = await glob(file, { nodir: true, fs });
            for (const path of globPaths) {
                paths.add(nodePath.resolve(path));
            }
        } else {
            paths.add(nodePath.resolve(file));
        }
    }
    return Array.from(paths);
}

/** @internal */
export type Context = Record<string, any>;

/** @internal */
export async function createContext(prog: ProgramContext) {
    const { command, fs } = prog;
    const options = command.opts();
    const context: Context = {};

    if (options.env !== undefined) {
        const envContent = await fs.promises.readFile(options.env, { encoding: 'utf-8' });
        const env = dotenv.parse(envContent);
        const expanded = dotenvExpand.expand({
            ignoreProcessEnv: true,
            parsed: env,
        });
        if (expanded.error) {
            throw expanded.error;
        }
        Object.assign(context, expanded.parsed);
    }

    for (const v of options.var ?? []) {
        const kv = parseVar(v);
        context[kv.key] = kv.value;
    }

    return context;
}

/** @internal */
export function parseVar(v: string): { key: string, value: any } {
    const equalPos = v.indexOf('=');
    if (equalPos === -1) {
        return {
            key: v,
            value: true,
        };
    }
    return {
        key: v.slice(0, equalPos),
        value: v.slice(equalPos + 1),
    };
}

