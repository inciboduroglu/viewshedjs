let gdal = require('gdal');
const USER_DATA_PATH = require('./paths_helper').USER_DATA_ABS_PATH;
const metadata_path = USER_DATA_PATH.METADATA;
const ELEVATION_DATASET_PATH = USER_DATA_PATH.ELEVATION_DATASET;
let file_operations = require('./file_operations_helper');
let tile_indexer = require('../gdal/tile_indexer');
const METADATA_FILE_NAME = 'metadata.json';
const DEFAULT_PROJECTION = '4326';

exports.getMetadata = function () {
  try {
    return require(metadata_path);
  } catch (error) {
    return {};
  }
};

/**
 * Returns all the projections found in the metadata
 */
exports.getProjections = function () {
  let srs = exports.getSrs();
  let regEx = /AUTHORITY\[\"([A-z]+)\",\"(\d{4})\"\]/;
  // let match = srs.match(regEx);
  let matches = getCapturedGroups(srs, regEx);

  console.log(matches);
  return matches;
};

/**
 * Function to get captured groups of regEx pattern
 * @param str
 * @param regEx
 * @returns {Array}
 */
function getCapturedGroups(str, regEx) {
  let searching = true;
  const matches = [];
  let match;

  do {
    match = str.match(regEx);
    if (match !== null) {
      let type = match[1];
      let id = match[2];

      matches.push({type, id});
      str = str.replace(regEx, '');
    } else {
      searching = false;
    }
  } while (searching);

  return matches;
}

exports.getSrs = function () {
  return exports.getMetadata().srs;
};

exports.getGeoTransform = function () {
  return JSON.parse(JSON.stringify(exports.getMetadata().geoTransform));
};

exports.getProjection = function () {
  let metadata = exports.getMetadata();
  if (metadata.projection)
    return metadata.projection;
  else {
    try {
      let projections = exports.getProjections();
      return projections[0][1];
    } catch (error) {
      return DEFAULT_PROJECTION
    }
  }
};

exports.findSampleDataset = function () {
  let fileNames = file_operations.readDirectory(ELEVATION_DATASET_PATH);
  let dataset;
  for (let fileName of fileNames) {
    dataset = tile_indexer.openDataset(fileName);
    if (dataset) {
      return (dataset);
      // break;
    }
  }
};

/**
 * Saves metadata from sample data found in elevation datasets folder
 */
/* istanbul ignore next */
exports.saveMetadata = function () {
  let sampleDataset = exports.findSampleDataset();
  let srs = sampleDataset.srs.toWKT();
  let geoTransform = sampleDataset.geoTransform;
  let projection = exports.getProjection();

  file_operations.writeArrayToFile({
    srs,
    geoTransform,
    projection
  }, ELEVATION_DATASET_PATH + METADATA_FILE_NAME);
};

/**
 * Used to change the selected projection
 * @param projection
 */
/* istanbul ignore next */
exports.saveProjection = function (projection) {
  try {
    let metadata = exports.getMetadata();
    metadata.projection = projection;
    file_operations.writeArrayToFile(metadata, ELEVATION_DATASET_PATH + METADATA_FILE_NAME);
    return projection;
  } catch (error) {
    return undefined;
  }
};

// exports.saveMetadata();
// exports.saveProjection(3);