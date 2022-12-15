#!/usr/bin/env node

import { run } from "./app";

(async () => {
    await run();
    process.exit();
})().then(e => { throw e; });