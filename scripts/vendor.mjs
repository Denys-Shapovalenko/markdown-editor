import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('src/MarkdownEditor/Editor/vendor', { recursive: true });
await copyFile('node_modules/marked/lib/marked.esm.js', 'src/MarkdownEditor/Editor/vendor/marked.js');
await copyFile('node_modules/marked/LICENSE', 'src/MarkdownEditor/Editor/vendor/marked.LICENSE');
