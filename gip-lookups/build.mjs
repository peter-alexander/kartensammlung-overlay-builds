import fs from "node:fs";
import path from "node:path";

const inputDir = path.resolve(
	process.argv[2] || "gip-lookups/input"
);
const outputFile = path.resolve(
	process.argv[3]
		|| "gip-lookups/build/GipLookups.json"
);

function decodeBuffer(buffer) {
	try {
		return new TextDecoder(
			"utf-8",
			{
				fatal: true
			}
		).decode(buffer);
	} catch (_) {
		return new TextDecoder(
			"windows-1252"
		).decode(buffer);
	}
}

function parseCsv(text, delimiter) {
	const rows = [];
	let row = [];
	let value = "";
	let quoted = false;

	for (
		let index = 0;
		index < text.length;
		index += 1
	) {
		const char = text[index];

		if (quoted) {
			if (char === '"') {
				if (text[index + 1] === '"') {
					value += '"';
					index += 1;
				} else {
					quoted = false;
				}
			} else {
				value += char;
			}
			continue;
		}

		if (char === '"') {
			quoted = true;
			continue;
		}
		if (char === delimiter) {
			row.push(value);
			value = "";
			continue;
		}
		if (char === "\n") {
			row.push(value);
			rows.push(row);
			row = [];
			value = "";
			continue;
		}
		if (char === "\r") {
			continue;
		}

		value += char;
	}

	if (
		value.length > 0
		|| row.length > 0
	) {
		row.push(value);
		rows.push(row);
	}

	return rows;
}

function detectDelimiter(text) {
	const candidates = [
		",",
		";",
		"\t"
	];
	let best = ",";
	let bestCount = 0;

	for (const delimiter of candidates) {
		const first = parseCsv(
			text,
			delimiter
		)[0] || [];

		if (first.length > bestCount) {
			best = delimiter;
			bestCount = first.length;
		}
	}

	return best;
}

function normalizeCell(value) {
	const normalized = String(
		value ?? ""
	).trim();

	return normalized === ""
		? null
		: normalized;
}

function normalizeGroupName(fileName) {
	return path.basename(
		fileName,
		path.extname(fileName)
	)
		.replace(/^lut_/i, "")
		.replace(/_csv$/i, "")
		.replace(/_\d{12,14}$/, "")
		.toLowerCase();
}

function displayValue(row) {
	for (const key of [
		"long_name",
		"short_name",
		"name",
		"code",
		"id",
		"short_id"
	]) {
		const value = row[key];

		if (
			value !== null
			&& value !== undefined
			&& value !== ""
		) {
			return value;
		}
	}

	return null;
}

function addIndex(
	index,
	key,
	value
) {
	if (
		key === null
		|| key === undefined
		|| key === ""
	) {
		return;
	}

	index[String(key)] = value;
}

function addDisplayIndex(
	index,
	key,
	display
) {
	if (
		key === null
		|| key === undefined
		|| key === ""
		|| display === null
		|| display === undefined
		|| display === ""
	) {
		return;
	}

	index[String(key)] = display;
}

function readLookupCsv(filePath) {
	const text = decodeBuffer(
		fs.readFileSync(filePath)
	);
	const delimiter = detectDelimiter(text);
	const rows = parseCsv(
		text,
		delimiter
	);

	if (rows.length < 2) {
		throw new Error(
			`Leere oder ungültige Lookup-Tabelle: ${filePath}`
		);
	}

	const header = rows.shift()
		.map(normalizeCell);
	const outputRows = [];
	const byId = {};
	const byShortId = {};
	const byCode = {};
	const byName = {};
	const displayById = {};
	const displayByShortId = {};
	const displayByCode = {};
	const displayByName = {};

	for (const values of rows) {
		if (
			values.length === 1
			&& !String(values[0] || "").trim()
		) {
			continue;
		}

		const row = {};

		for (
			let index = 0;
			index < header.length;
			index += 1
		) {
			const key = header[index];

			if (!key) continue;
			row[key] = normalizeCell(
				values[index]
			);
		}

		const display = displayValue(row);
		row.display = display;
		const rowIndex = outputRows.length;
		outputRows.push(row);

		addIndex(
			byId,
			row.id,
			rowIndex
		);
		addIndex(
			byShortId,
			row.short_id,
			rowIndex
		);
		addIndex(
			byCode,
			row.code,
			rowIndex
		);
		addIndex(
			byName,
			row.name,
			rowIndex
		);

		addDisplayIndex(
			displayById,
			row.id,
			display
		);
		addDisplayIndex(
			displayByShortId,
			row.short_id,
			display
		);
		addDisplayIndex(
			displayByCode,
			row.code,
			display
		);
		addDisplayIndex(
			displayByName,
			row.name,
			display
		);
	}

	return {
		columns: header.filter(Boolean),
		rows: outputRows,
		by_id: byId,
		by_short_id: byShortId,
		by_code: byCode,
		by_name: byName,
		display_by_id: displayById,
		display_by_short_id:
			displayByShortId,
		display_by_code: displayByCode,
		display_by_name: displayByName,
		delimiter
	};
}

if (!fs.existsSync(inputDir)) {
	throw new Error(
		`GIP lookup input directory fehlt: ${inputDir}`
	);
}

const csvFiles = fs.readdirSync(inputDir)
	.filter((fileName) => (
		/\.csv$/i.test(fileName)
	))
	.sort((a, b) => (
		a.localeCompare(
			b,
			"en",
			{
				numeric: true,
				sensitivity: "base"
			}
		)
	));

if (csvFiles.length < 10) {
	throw new Error(
		`Unplausibel wenige GIP-Lookuptabellen: ${csvFiles.length}`
	);
}

const latestByGroup = new Map();

for (const fileName of csvFiles) {
	latestByGroup.set(
		normalizeGroupName(fileName),
		fileName
	);
}

for (const required of [
	"base_type",
	"bike_feature",
	"edge_category"
]) {
	if (!latestByGroup.has(required)) {
		throw new Error(
			`GIP-Lookuptabelle fehlt: ${required}`
		);
	}
}

const catalog = {
	_meta: {
		source: "D_lookuptabellen",
		format: "gip-lookup-index-v2",
		source_url:
			"https://open.gip.gv.at/ogd/D_lookuptabellen.zip",
		table_count: latestByGroup.size
	}
};

for (
	const [group, fileName]
	of [...latestByGroup.entries()]
		.sort(([a], [b]) => (
			a.localeCompare(
				b,
				"en",
				{
					numeric: true,
					sensitivity: "base"
				}
			)
		))
) {
	catalog[group] = {
		...readLookupCsv(
			path.join(
				inputDir,
				fileName
			)
		),
		source_file: fileName
	};
}

fs.mkdirSync(
	path.dirname(outputFile),
	{
		recursive: true
	}
);
fs.writeFileSync(
	outputFile,
	JSON.stringify(catalog) + "\n",
	"utf8"
);

console.log(
	[
		`GIP Lookups: ${latestByGroup.size} Tabellen`,
		`CSV-Dateien im Archiv: ${csvFiles.length}`,
		`Ausgabe: ${outputFile}`
	].join("\n")
);
