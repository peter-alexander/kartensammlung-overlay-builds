import RBush from 'rbush';

import Feature from 'ol/Feature.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import { toLonLat } from 'ol/proj.js';
import { getLength } from 'ol/sphere.js';

import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import LineMerger from 'jsts/org/locationtech/jts/operation/linemerge/LineMerger.js';
import RobustLineIntersector from 'jsts/org/locationtech/jts/algorithm/RobustLineIntersector.js';

export function getNodeDeps() {
	return {
		RBush,
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
