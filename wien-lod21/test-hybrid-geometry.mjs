#!/usr/bin/env node

import assert from "node:assert/strict";
import {
	buildHybridRemainders,
	deriveOgdHeights,
	historicalGroundFootprint
} from "./hybrid-geometry.mjs";

function ground(minX, minY, maxX, maxY) {
	return [{
		semantic: "ground",
		rings: [[
			{ x: minX, y: minY, z: 100 },
			{ x: maxX, y: minY, z: 100 },
			{ x: maxX, y: maxY, z: 100 },
			{ x: minX, y: maxY, z: 100 }
		]]
	}];
}

function feature(id, coordinates, properties = {}) {
	return {
		type: "Feature",
		properties: {
			FMZK_ID: id,
			O_KOTE: 120,
			T_KOTE: 100,
			...properties
		},
		geometry: {
			type: "Polygon",
			coordinates: [coordinates]
		}
	};
}

assert.deepEqual(
	deriveOgdHeights({ O_KOTE: 120, T_KOTE: 100, U_KOTE: 104 }),
	{ height: 20, base: 4 }
);
assert.deepEqual(
	deriveOgdHeights({ O_KOTE: "120,5", HOEHE_DGM: "100,0" }),
	{ height: 20.5, base: 0 }
);
assert.equal(deriveOgdHeights({ O_KOTE: 120 }), null);

const oldSurfaces = ground(0, 0, 10, 10);
assert.equal(Number(historicalGroundFootprint(oldSurfaces).getArea().toFixed(3)), 100);

const target = {
	historicalCode: "123456",
	rolloutMode: "manual-pilot-hybrid",
	ksIds: ["wien-fmzk:1"]
};
const features = new Map([[
	"wien-fmzk:1",
	feature("1", [[0, 0], [15, 0], [15, 10], [0, 10], [0, 0]])
]]);
const remainders = buildHybridRemainders(target, oldSurfaces, features);
assert.equal(remainders.length, 1);
assert.equal(remainders[0].ksId, "wien-fmzk:1");
assert.equal(remainders[0].height, 20);
assert.equal(remainders[0].base, 0);
assert.equal(remainders[0].areaM2, 50);

const identical = new Map([[
	"wien-fmzk:1",
	feature("1", [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])
]]);
assert.deepEqual(buildHybridRemainders(target, oldSurfaces, identical), []);

const directTarget = {
	...target,
	rolloutMode: "direct-strong"
};
assert.deepEqual(buildHybridRemainders(directTarget, oldSurfaces, features), []);

console.log("Vienna LOD2.1 hybrid remainder geometry: OK");
