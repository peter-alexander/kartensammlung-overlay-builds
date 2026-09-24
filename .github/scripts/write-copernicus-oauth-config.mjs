import fs from 'node:fs';

const clientId = String(process.env.COPERNICUS_CLIENT_ID || '').trim();
const clientSecret = String(process.env.COPERNICUS_CLIENT_SECRET || '').trim();
const output = String(process.argv[2] || '').trim();

if (!clientId || !clientSecret) {
	throw new Error('COPERNICUS_CLIENT_ID oder COPERNICUS_CLIENT_SECRET fehlt.');
}

if (!output) {
	throw new Error('Ausgabedatei fehlt.');
}

function phpString(value) {
	return "'" + value
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'") + "'";
}

const content = [
	'<?php',
	'declare(strict_types=1);',
	'',
	'return [',
	`\t'client_id' => ${phpString(clientId)},`,
	`\t'client_secret' => ${phpString(clientSecret)},`,
	'];',
	''
].join('\n');

fs.mkdirSync(new URL('.', `file://${output.startsWith('/') ? '' : '/'}${output}`), { recursive: true });
fs.writeFileSync(output, content, { encoding: 'utf8', mode: 0o600 });
