import RBush from 'https://esm.sh/rbush@4.0.1';
import osmtogeojson from 'https://esm.sh/osmtogeojson@3.0.0-beta.5';

import Feature from 'https://cdn.jsdelivr.net/npm/ol@10.6.1/Feature.js';
import GeoJSON from 'https://cdn.jsdelivr.net/npm/ol@10.6.1/format/GeoJSON.js';
import LineString from 'https://cdn.jsdelivr.net/npm/ol@10.6.1/geom/LineString.js';
import Point from 'https://cdn.jsdelivr.net/npm/ol@10.6.1/geom/Point.js';
import { toLonLat } from 'https://cdn.jsdelivr.net/npm/ol@10.6.1/proj.js';
import { getLength } from 'https://cdn.jsdelivr.net/npm/ol@10.6.1/sphere.js';

import GeometryFactory from 'https://cdn.jsdelivr.net/npm/jsts@2.12.1/org/locationtech/jts/geom/GeometryFactory.js';
import Coordinate from 'https://cdn.jsdelivr.net/npm/jsts@2.12.1/org/locationtech/jts/geom/Coordinate.js';
import LineMerger from 'https://cdn.jsdelivr.net/npm/jsts@2.12.1/org/locationtech/jts/operation/linemerge/LineMerger.js';
import RobustLineIntersector from 'https://cdn.jsdelivr.net/npm/jsts@2.12.1/org/locationtech/jts/algorithm/RobustLineIntersector.js';

export function getBrowserDeps() {
	return {
		RBush,
		osmtogeojson,
		Feature,
		GeoJSON,
		Point,
		LineString,
		toLonLat,
		getLength,
		GeometryFactory,
		Coordinate,
		LineMerger,
		RobustLineIntersector
	};
}