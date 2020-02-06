let gdal = require('gdal');
let file_operations = require("../helpers/file_operations_helper");
let metadata_helper = require('../helpers/metadata_helper');
const USER_DATA_PATH = require('../helpers/paths_helper').USER_DATA_ABS_PATH;
const ELEVATION_DATASET_PATH = USER_DATA_PATH.ELEVATION_DATASET;
const ALLOWED_FILE_EXTENSIONS = ['tif', 'dt2', 'hgt'];
const EMPTY_CELL_VALUE = null;

exports.runIndexer = function (callback) {
  try {
    // Read file names from the designated directory for data tiles
    let fileNames = file_operations.readDirectory(ELEVATION_DATASET_PATH);
    // index files
    let indexedTiles = exports.indexTiles(fileNames);
    replaceNulls(indexedTiles.tileNames, () => {
      return 'sea_tile'
    });
    replaceNulls(indexedTiles.originPoints, exports.replaceOriginPointNulls);

    // save file names and origins
    file_operations.writeArrayToFile(indexedTiles.tileNames, ELEVATION_DATASET_PATH + 'tile_names.json');
    file_operations.writeArrayToFile(indexedTiles.originPoints, ELEVATION_DATASET_PATH + 'origins.json');

    // save geo transform and srs string
    metadata_helper.saveMetadata();
  } catch (error) {
    if (callback) callback({error});
  }
  if (callback) callback({error: null});
};

exports.replaceOriginPointNulls = function (origins, i, j) {
  let row = getRow(i, origins);
  let column = getColumn(j, origins);

  let lat = getDefinedValue(row, 'lat');
  let lon = getDefinedValue(column, 'lon');
  let rasterSize = {y: getDefinedValue(row, 'rasterSize').y, x: getDefinedValue(column, 'rasterSize').x};

  return {lat, lon, rasterSize};
};

function replaceNulls(array, f) {
  //console.log('replace nulls');
  for (let i = 0; i < array.length; i++) {
    let row = array[i];
    let j = row.indexOf(null);

    while (j >= 0) {
      row[j] = f(array, i, j);
      j = row.indexOf(null);
    }
  }
}

function create2DArray(rowNum, columnNum) {
  const arr = [];

  for (let row = 0; row < rowNum; row++) {
    let tempRow = [];
    for (let column = 0; column < columnNum; column++) {
      tempRow.push(EMPTY_CELL_VALUE);
    }
    arr.push(tempRow);
  }

  return arr;
}

exports.indexTiles = function (fileNames) {
  let gdal_service = require("./gdal_service");

  // tile names and origin points will be populated according to their starting locations
  let tileNames;
  let originPoints;

  // Read file names from the designated directory for data tiles
  // let fileNames = exports.readDirectory(ELEVATION_DATASET_PATH);

  // for every tile find where its located and save to 2d array
  for (let i in fileNames) {
    let fileName = fileNames[i];
    let dataset = exports.openDataset(fileName);

    if (dataset) {
      let geoTransforms = dataset.geoTransform;
      let rasterSize = dataset.rasterSize;
      // g0 & gt3 top left corner of top left pixel
      // console.log(geoTransforms);
      let origin = {
        lat: gdal_service.getTrueLat(0, 0, geoTransforms),
        lon: gdal_service.getTrueLon(0, 0, geoTransforms),
        rasterSize
      };
      let placement = exports.getTilePlacement(originPoints, origin);
      let expansion = exports.calculateExpansionDirection(origin, originPoints, placement);
      originPoints = exports.placeTile(origin, originPoints, placement, expansion);
      tileNames = exports.placeTile(fileName, tileNames, placement, expansion);
    }
    // console.log(i);
    // printArray(tileNames);
  }

  // save tile names and origin points to file
  return {originPoints, tileNames};
};

/* istanbul ignore next */
function printArray(array) {
  for (let i = 0; i < array.length; i++) {
    for (let j = 0; j < array[i].length; j++) {
      process.stdout.write(`${array[i][j]} | `);
      // console.log(array[i][j], ' | ');
    }
    process.stdout.write(`\n`);
  }
}

/**
 * Finds index of given lat and lon in originPoints array
 * @param originPoints - 2d array with lat lon values
 * @param origin - lat lon values of the new data point
 * @returns {*} - i and j values, row and column of the data point.
 */
exports.getTilePlacement = function (originPoints, origin) {
  if (!(originPoints && originPoints.length && originPoints[0]))
    return {i: 0, j: 0};
  // originPoints is assumed to be a 2d array
  let rowNum = originPoints.length;
  let columnNum = originPoints[0].length;
  let lat = origin.lat;
  let lon = origin.lon;

  let lastI;
  let lastJ;
  for (let i = 0; i < rowNum; i++) {
    // new lat greater or equal to saved lat search columns for its place horizontally
    let savedLat = getDefinedValue(getRow(i, originPoints), 'lat');
    if (lat >= savedLat && !lastI && lastI !== 0)
      lastI = i;
  }

  for (let j = 0; j < columnNum; j++) {
    let savedLon = getDefinedValue(getColumn(j, originPoints), 'lon');
    if (lon <= savedLon && !lastJ && lastJ !== 0) {
      // the place if condition is satisfied should be where the data point should go
      lastJ = j;
    }
  }

  // lastX === 0 checks for falsy values
  return {
    i: (lastI || lastI === 0) ?
      lastI : rowNum,
    j: (lastJ || lastJ === 0) ?
      lastJ : columnNum
  };
};

function getDefinedValue(array, valueType) {
  for (let j in array) {
    if (array[j]) {
      let value = array[j][valueType];
      if (value || value === 0)
        return value;
    }
  }
}

function getColumn(index, array) {
  let column = [];
  for (let i = 0; i < array.length; i++) {
    column.push(array[i][index]);
  }
  return column;
}

function getRow(index, array) {
  return array[index];
}

exports.placeTile = function (content, array, placement, expansion) {
  // create at least 1 row and 1 column
  if (!array || array.length === 0) {
    array = create2DArray(1, 1);
    array[0][0] = content;
    return array;
  }

  // check if given indices are full
  let i = placement.i;
  let j = placement.j;

  // expand according to expansion parameter
  if (expansion.row)
    addRowAt(i, array);
  if (expansion.column)
    addColumnAt(j, array);

  let row = array[i];
  row.splice(j, 1, content);

  array[i] = row;
  return array;
};

exports.calculateExpansionDirection = function (content, array, placement) {
  let i = placement.i;
  let j = placement.j;
  let expansion = {};

  if (!array || array === [])
    return {row: true, column: true};

  // if there is a datapoint where the new one will bu put
  if (i >= array.length) // outside of array bounds
    expansion.row = true;
  if (j >= array[0].length)
    expansion.column = true;

  try {
    // uses the column or rows value
    let savedLat = getDefinedValue(getRow(i, array), 'lat');
    let savedLon = getDefinedValue(getColumn(j, array), 'lon');

    if (savedLat < content.lat) {
      expansion.row = true;
    }

    if (savedLon > content.lon) {
      expansion.column = true;
    }
    // }
  } catch (err) {
  }
  return expansion;
};

function addColumnAt(index, array) {
  let rowNum = array.length;

  for (let i = 0; i < rowNum; i++) {
    array[i].splice(index, 0, null);
  }
}

function addRowAt(index, array) {
  // takes the 0th element of created array because the function returns 2d array
  let oneRowArray = create2DArray(1, array[0].length)[0];
  array.splice(index, 0, oneRowArray);
}

/* istanbul ignore next */
exports.openDataset = function (fileName) {
  if (findIfArrayElementExists(ALLOWED_FILE_EXTENSIONS, getFileExtension(fileName))) {
    try {
      return gdal.open(ELEVATION_DATASET_PATH + fileName);
    } catch (error) {
      console.log('Couldn\'t open dataset', fileName);
    }
  }
};

/* istanbul ignore next */
function findIfArrayElementExists(array, element) {
  return array.indexOf(element) >= 0;
}

function getFileExtension(fileName) {
  let tokens = fileName.split('.');
  return tokens[tokens.length - 1];
}

exports.EXPANSION_DIRECTION_TYPE_COLUMN = 'column';
exports.EXPANSION_DIRECTION_TYPE_ROW = 'row';
exports._private = {
  getFileExtension,
  create2DArray,
  addColumnAt,
  addRowAt,
  getDefinedValue,
  getRow,
  getColumn,
};

// exports.runIndexer();
