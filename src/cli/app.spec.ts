import test from 'ava';
import { run } from './app';
import memfs from 'memfs';

test('example', async t => {
    const vol = new memfs.Volume();
    const fs = memfs.createFsFromVolume(vol);

    const codeFiles = {
        '/foo/a.js':
            `// #if foo == 31
console.log('foo');
// #else
console.log('bar');
// #endif`,
        '/bar/b.js':
            `// #if bar == 17
console.log('fizz');
// #else
console.log('buzz');
// #endif`,
    };

    await Promise.all([
        vol.promises.mkdir('/foo'),
        vol.promises.mkdir('/bar'),
        ...Object.entries(codeFiles)
            .map(([path, code]) => fs.promises.writeFile(path, code)),
        fs.promises.writeFile('/.env', 'foo=31\nbar=17'),
    ]);

    const argv = [
        process.argv[0],
        process.argv[1],
        '-i',
        '-e',
        '/.env',
        '-v',
        'bar=89',
        '--',
        '/foo/a.js',
        '/bar/b.js',
    ];

    await run({ argv, fs });

    const compiledCode = await readObjKeyPaths(codeFiles, fs);

    t.is(compiledCode['/foo/a.js'], `console.log('foo');\n`);
    t.is(compiledCode['/bar/b.js'], `console.log('buzz');\n`);
});

test('glob', async t => {
    const vol = new memfs.Volume();
    const fs = memfs.createFsFromVolume(vol);

    const codeFiles = {
        '/a.js': '// #if FOO\n1\n// #endif',
        '/b.js': '// #if FOO\n2\n// #endif',
    };

    await Promise.all([
        ...Object.entries(codeFiles)
            .map(([path, code]) => fs.promises.writeFile(path, code)),
    ]);

    const argv = [
        process.argv[0],
        process.argv[1],
        '-i', '-v', 'FOO', '-g', '/*.js',
    ];

    await run({ argv, fs });

    const compiledCode = await readObjKeyPaths(codeFiles, fs);

    t.is(compiledCode['/a.js'], `1\n`);
    t.is(compiledCode['/b.js'], `2\n`);
});

async function readObjKeyPaths(obj: Record<string, any>, fs: any) {
    const keys = Object.keys(obj);
    return (await Promise.all(
        keys.map(path => fs.promises.readFile(path, { encoding: 'utf-8' }))
    )).reduce((obj, code, i) => {
        obj[keys[i]] = code as string;
        return obj;
    }, {} as Record<string, string>);
}