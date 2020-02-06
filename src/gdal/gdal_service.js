let gdal = require('gdal');
const cp = require('child_process');
const metadata_helper = require('../helpers/metadata_helper');
const file_operations = require('../helpers/file_operations_helper');

// paths
const USER_DATA_PATH = require('../helpers/paths_helper').USER_DATA_ABS_PATH;
const tileNames_path = USER_DATA_PATH.TILE_NAMES;
const origins_path = USER_DATA_PATH.ORIGINS;
const VIEWSHED_WORKSPACE_PATH = USER_DATA_PATH.VIEWSHED_WORKSPACE;
const VIEWSHED_IMAGE_PATH = USER_DATA_PATH.VIEWSHED;
const ELEVATION_DATASET_PATH = USER_DATA_PATH.ELEVATION_DATASET;

/**
 *
 * @param dataset
 * @param xo
 * @param yo
 * @param width
 * @param height
 * @returns {*[]}
 */
exports.readDataset = function (dataset, {xo, yo, width, height}) {
  // open dataset
  let bands = dataset.bands;
  let blockHeight = height ? height : dataset.rasterSize.y;
  let blockWidth = width ? width : dataset.rasterSize.x;
  let blockStartX = xo ? xo : 0;
  let blockStartY = yo ? yo : 0;
  let n = blockWidth * blockHeight;
  let data = new Int16Array(new ArrayBuffer(n * 2));

  if (bands) {
    let band = bands.get(1);
    let pixels = band.pixels;
    try {
      pixels.read(blockStartX, blockStartY, blockWidth, blockHeight, data);
    } catch (error) {
      console.log(`Read error:\n x: ${xo}, y: ${yo},\n block width: ${blockWidth}, height: ${blockHeight},\n startX: ${blockStartX}, startY: ${blockStartY},\n rasterSize: x: ${dataset.rasterSize.x} y: ${dataset.rasterSize.y}`);
    }
  }

  // return Array.from(data);
  return makeBlock(Array.from(data), blockWidth, blockHeight);//.reverse();
};

/* istanbul ignore next*/
exports.getDataset = function (i, j) {
  const tileNames = require(tileNames_path);
  let tileName = tileNames[i][j];

  if (tileName === 'sea_tile')
    return generateSeaTile(i, j);
  if (!file_operations.checkFileExists(ELEVATION_DATASET_PATH + tileName) && callback)
    throw new Error();
  return gdal.open(ELEVATION_DATASET_PATH + tileName);
  // return gdal.open('./src/backend/back/gdal/dataset/' + tileNames[i][j]);
  // return gdal.open('./dataset/' + tileNames[i][j]);
};

function generateSeaTile(i, j) {
  let origin = require(origins_path)[i][j];

  return {
    rasterSize: origin.rasterSize,
    geoTransform: makeGeoTransform(origin.lat, origin.lon)
  }
}

/**
 * creates 2d array from 1d array
 * @param data - 1d array
 * @param blockWidth
 * @param blockHeight
 * @returns {*[]}
 */
function makeBlock(data, blockWidth, blockHeight) {
  let block = [];

  for (let i = 0; i < blockHeight; i++) {
    // let row = blockHeight[i];
    block.push(data.splice(0, blockWidth));
  }
  return block;
}

function makeVector(block) {
  let blockHeight = block.length;
  let vector = [];

  for (let i = 0; i < blockHeight; i++) {
    let row = block[i];
    vector = vector.concat(row);
  }

  return vector;
}

/**
 * Returns elevation data with the given coordinates
 * @param xo - start longitude
 * @param yo - start latitude
 * @param xf - end longitude
 * @param yf - end latitude
 * @param callback - result returning callback
 */
exports.getElevationData = function ({xo, yo, xf, yf}, callback) {
  const setup = elevationSetup({xo, yo, xf, yf});
  processTiles(setup, {xo, yo, xf, yf}, callback);
};

function elevationSetup({xo, yo, xf, yf}) {
  // get datasets containing the start and end indices
  let indicesStart = findDatasetIndex(yo, xo);
  let indicesEnd = findDatasetIndex(yf, xf);
  let datasetStart = exports.getDataset(indicesStart.i, indicesStart.j);
  let datasetEnd = exports.getDataset(indicesEnd.i, indicesEnd.j);
  let pixelStart = roundPixels(getPixels(xo, yo, datasetStart.geoTransform));
  let pixelEnd = roundPixels(getPixels(xf, yf, datasetEnd.geoTransform));

  return {pixelStart, pixelEnd, indicesStart, indicesEnd};
}

function processTiles(s, {xo, yo, xf, yf}, callback) {
  const tileNames = require(tileNames_path);

  let x, y = s.pixelStart.y, dataset, data, rowData;
  // for every row
  for (let i = s.indicesStart.i; i <= s.indicesEnd.i; i++) {
    console.log(i);
    x = s.pixelStart.x;
    // for every column
    for (let j = s.indicesStart.j; j <= s.indicesEnd.j; j++) {
      console.log('\t', j, tileNames[i][j]);
      // fetch dataset
      dataset = exports.getDataset(i, j);
      let blockSize = calculateBlockSize(dataset, {xo: x, yo: y}, {i, j}, s.indicesEnd, s.pixelEnd);

      if (rowData) {
        rowData = concat2dHorizontal([rowData, exports.readDataset(dataset, {
          xo: x,
          yo: y,
          width: blockSize.width,
          height: blockSize.height
        })]);
      } else {
        rowData = exports.readDataset(dataset, {xo: x, yo: y, width: blockSize.width, height: blockSize.height});
      }
      // x is zero for every other column other than the first
      x = 0;
    }
    if (data)
      data = concat2dVertical([data, rowData]);
    else
      data = rowData;
    // re initialize row data and y for every row
    rowData = undefined;
    y = 0;
  }

  callback(data);
}

exports.getElevationDataSinglePoint = function ({xo, yo}, callback) {
  let point;
  try {
    let indices = findDatasetIndex(yo, xo);
    let dataset = exports.getDataset(indices.i, indices.j);
    let pixels = getPixels(xo, yo, dataset.geoTransform);
    point = exports.readDataset(dataset, {xo: pixels.x, yo: pixels.y, width: 1, height: 1})[0][0];
  } catch(error) {
    console.log('Can\'t find elevation at ', xo, yo);
  }

  callback(point);
};

/**
 * Calculates block size for readDataset function
 * @param dataset - given for raster size
 * @param xo - starting x
 * @param yo - starting y
 * @param i - datasets row
 * @param j - datasets column
 * @param indicesEnd - where the reading will end (as i an j)
 * @param pixelEnd - where the reading will end (as pixels - x and y)
 * @returns {{width: *, height: *}} - height and width of the block to be read from the given dataset
 */
function calculateBlockSize(dataset, {xo, yo}, {i, j}, indicesEnd, pixelEnd) {
  let size = dataset.rasterSize;
  let height, width;

  // last row, go up to y's pixelEnd
  if (indicesEnd.i == i)
    height = pixelEnd.y - yo;
  else
    height = size.y - yo;

  // last column, go up to x's pixelEnd
  if (indicesEnd.j == j)
    width = pixelEnd.x - xo;
  else
    width = size.x - xo;

  return {width, height};
}

function roundPixels(pixels) {
  return {x: Math.round(pixels.x), y: Math.round(pixels.y)};
}

/**
 * Finds the index of the dataset given lat and lon resides in
 * @param lat
 * @param lon
 * @returns {*}
 */
function findDatasetIndex(lat, lon) {
  let TEMP_GEO_TRANSFORM = metadata_helper.getGeoTransform();

  const origins = require(origins_path);
  let indices;

  for (let i in origins) {
    if (origins.hasOwnProperty(i)) {
      let row = origins[i];

      for (let j in row) {
        if (row.hasOwnProperty(j)) {
          let origin = row[j];

          if (origin) {
            let geoTransform = makeGeoTransform(origin.lat, origin.lon);
            let y = exports.getTrueLat(0, 0, geoTransform) + (TEMP_GEO_TRANSFORM[5] / 2);
            let x = exports.getTrueLon(0, 0, geoTransform) + (TEMP_GEO_TRANSFORM[1] / 2);

            if (x <= lon && y >= lat) {
              // indices = {i, j};
              indices = {i: Number.parseInt(i), j: Number.parseInt(j)};
            }
          }
        }
      }
    }
  }
  return indices;
}

/** Longitude = x */
exports.getTrueLon = function (x, y, geoTransform) {
  return geoTransform[0] + x * geoTransform[1] + y * geoTransform[2];
};

/** Latitude = y */
exports.getTrueLat = function (x, y, geoTransform) {
  return geoTransform[3] + x * geoTransform[4] + y * geoTransform[5];
};

function getPixels(xGeo, yGeo, geoTransforms) {
  let det_ = det([
    [geoTransforms[1], geoTransforms[2]],
    [geoTransforms[4], geoTransforms[5]]
  ]);
  let detX = det([
    [xGeo - geoTransforms[0], geoTransforms[2]],
    [yGeo - geoTransforms[3], geoTransforms[5]]
  ]);
  let detY = det([
    [geoTransforms[1], xGeo - geoTransforms[0]],
    [geoTransforms[4], yGeo - geoTransforms[3]]
  ]);

  let x = detX / det_;
  let y = detY / det_;

  return {
    x: parseToPrecision12(x),
    y: parseToPrecision12(y)
  };
}

function det(matrix) {
  return matrix[0][0] * matrix[1][1] - matrix[1][0] * matrix[0][1];
}

function parseToPrecision12(value) {
  return parseFloat(value.toPrecision(12));
}

/**
 * concatenates 2d arrays
 * @param arrays - array of arrays
 * @param axis - concatenation axis. 0-> vertical, 1-> horizontal
 * @returns {Array}
 */
function concat2d(arrays, axis = 0) {
  if (axis === 0)
    return concat2dVertical(arrays);
  else if (axis === 1)
    return concat2dHorizontal(arrays);
  return [];
}

function concat2dVertical(arrays) {
  // copy array
  let resultArray = arrays[0].slice(0, arrays[0].length);

  // starting from array 2
  for (let k = 1; k < arrays.length; k++) {
    let array = arrays[k];

    // concat each array
    resultArray = resultArray.concat(array);
  }

  return resultArray;
}

function concat2dHorizontal(arrays) {
  // copy array
  let resultArray = arrays[0].slice(0, arrays[0].length);

  // for each array other than the first
  for (let k = 1; k < arrays.length; k++) {
    let array = arrays[k];

    // concat each row
    for (let i = 0; i < array.length; i++) {
      let row = array[i];
      resultArray[i] = resultArray[i].concat(row);
    }
  }

  return resultArray;
}

/**
 *
 * @param lat
 * @param lon
 * @returns {{lat: *, lon: *}} - format it as string with util.format
 */
function prettyPoint(lat, lon) {
  return {
    lat: gdal.decToDMS(lat, 'Lat'),
    lon: gdal.decToDMS(lon, 'Long')
  }
}

exports.saveData = function (data, {yo, xo}, fileName, callback) {
  let srsString = metadata_helper.getSrs();

  let ySize = data.length;
  let xSize = data[0].length;

  // define file driver
  let driver = gdal.drivers.get('GTiff'); // fixme
  let savePath = VIEWSHED_WORKSPACE_PATH + fileName;
  let dataset = driver.create(savePath, xSize, ySize, 1, gdal.GDT_Int16);
  let bandData = dataset.bands.get(1);

  // turn 2d array into int16 array buffer
  let vector = makeVector(data);
  let int16Array = new Int16Array(vector);

  // write band
  bandData.pixels.write(0, 0, xSize, ySize, int16Array);
  // define geo transforms and spatial reference
  dataset.srs = gdal.SpatialReference.fromWKT(srsString); // fixme
  dataset.geoTransform = makeGeoTransform(yo, xo);

  dataset.flush();

  callback(savePath);
};

function generateFileName({x, y, z, xo, yo, xf, yf, zt, radius}, extension) {
  let fileName = `vs_obs_${x}_${y}_${z}_st_${xo}_${yo}_en_${xf}_${yf}_rd_${radius}_zt_${zt}`;
  fileName = fileName.replace(/\./gi, '_');
  return fileName + extension;
}

function makeGeoTransform(lat, lon) {
  let geoTransformTemp = metadata_helper.getGeoTransform();
  geoTransformTemp[0] = lon;
  geoTransformTemp[3] = lat;
  return geoTransformTemp;
}

/**
 *
 * @param z
 * @param zt
 * @returns {boolean} - true if parameters are valid
 */
exports.checkParameterValidity = function (z, zt) {
  // z is falsy but not 0 or zt is falsy but not 0
  return !(!z && z !== 0 || !zt && zt !== 0);
};

/**
 *
 * @param x - observer longitude
 * @param y - observer latitude
 * @param z - observer altitude
 * @param xo - starting long of analysis
 * @param yo - starting lan of analysis
 * @param xf - ending long of analysis
 * @param yf - ending lan of analysis
 * @param zt - target elevation
 * @param radius
 * @param callback - passed the location of resulting png file
 */
exports.analyzeViewshed = function ({x, y, z, xo, yo, xf, yf, zt, radius}, callback) {
  console.log(JSON.stringify({x, y, z, xo, yo, xf, yf, zt, radius}));
  if (!exports.checkParameterValidity(z, zt)) {
    callback({error: new Error('Invalid elevation values'), errorType: 'typeerror'});
    return 0;
  }

  // check if file exists. If exists bypass viewshed analysis and return existing file
  let existingFileName = generateFileName({x, y, z, xo, yo, xf, yf, zt, radius}, '.png');
  let existingFilePath = VIEWSHED_IMAGE_PATH + existingFileName;

  if (file_operations.checkFileExists(existingFilePath)) {
    console.log(`Viewshed file ${existingFileName} found in cache`);
    exports.returnExistingFile({xo, yo, xf, yf}, callback, existingFileName);
  } else
    exports.generateNewViewshed({x, y, z, xo, yo, xf, yf, zt, radius}, callback);
};

exports.generateNewViewshed = function ({x, y, z, xo, yo, xf, yf, zt, radius}, callback) {
  // read elevation data
  let elevationDataPromise = new Promise((readResolve) => {
    exports.getElevationData({xo, yo, xf, yf}, readResolve);
  });
  elevationDataPromise.then((data) => {
    console.log('Rasters read, saving to file.');
    // save read data to raster
    let saveDataPromise = new Promise((saveResolve) => {
      let saveFileName = generateFileName({x, y, z, xo, yo, xf, yf, zt, radius}, '.tif');
      exports.saveData(data, {yo, xo}, saveFileName, saveResolve);
    });
    // run sh script for viewshed analysis
    saveDataPromise.then((savePath) => {
      console.log('GoeTiff file created, starting viewshed analysis.');
      let analysisPromise = new Promise((analysisResolve) => {
        let location = generateFileName({x, y, z, xo, yo, xf, yf, zt, radius}, '');
        let viewshedFileName = generateFileName({x, y, z, xo, yo, xf, yf, zt, radius}, '.png');
        exports.runViewshedAnalysis(location, savePath, viewshedFileName, {x, y, z, zt, radius}, analysisResolve);
      });
      analysisPromise.then((fileName) => {
        console.log('Viewshed analysis finished. Resulting file is ', fileName);
        let imageData = {
          fileName: fileName,
          xo, yo, xf, yf,
          error: null
        };
        callback({imageData});
      }).catch((viewshedError) => {
        console.log('VIEWSHED ERROR', viewshedError);
        callback({error: viewshedError, errorType: 'viewshederror'});
      });
    }).catch((saveError) => {
      console.log('SAVE ERROR', saveError);
      callback({error: saveError, errorType: 'saveerror'});
    })
  }).catch((readError) => {
    console.log('READ ERROR', readError);
    callback({error: readError, errorType: 'readerror'});
  });
};

exports.returnExistingFile = function ({xo, yo, xf, yf}, callback, fileName) { // note: move to file helper
  let imageData = {
    fileName,
    xo, yo, xf, yf
  };
  callback({imageData});
};

exports.runViewshedAnalysis = function (location, inputPath, fileName, {x, y, z, zt, radius}, callback) {
  let outputPath = VIEWSHED_IMAGE_PATH + fileName;
  let observerCoordinates = x + ',' + y;
  let observerElevation = z;
  let targetElevation = zt;
  let sourceProjection = metadata_helper.getProjection();
  // const scriptsPath = '/home/inci/.config/AREHS_KA/ArehsKA_Setup_File/';
  const scriptsPath = USER_DATA_PATH.SCRIPT;
  const execCommand = `sh ${scriptsPath}viewshed.sh ${VIEWSHED_WORKSPACE_PATH} ${location} ${inputPath} ${outputPath} ${observerCoordinates} ${observerElevation} ${radius} ${scriptsPath}shade.ramp ${-targetElevation} ${sourceProjection}`;
  // console.log('EXEC COMMAND', execCommand);
  cp.exec(execCommand, function (error, stdout, stderr) {
    console.log('viewshed.sh::stdout:', stdout);
    console.log('viewshed.sh::stderr:', stderr);
    if (error != null) {
      console.log("exec error:" + error);
      callback({error});
    } else {
      callback(fileName);
    }
  });
};

exports.clearViewshedCache = function (callback) { // note: decide if should be moved to file helper
  let scriptsPath = USER_DATA_PATH.SCRIPT;
  console.log(`Looking at ${VIEWSHED_IMAGE_PATH} for viewshed image`);
  let execCommand = `sh ${scriptsPath}removeFiles.sh ${VIEWSHED_IMAGE_PATH}`;

  cp.exec(execCommand, function (error, stdout, stderr) {
    console.log('removeFiles.sh::stdout:', stdout);
    console.log('removeFiles.sh::stderr:', stderr);
    if (error != null) {
      console.log('removeFiles.sh::exec error', error);
      callback({error});
    } else {
      callback();
    }
  });
};

// let xyzXoYoXfYf = {
//   "x": 31,
//   "y": 45,
//   "z": 30,
//   "xo": 30.264083593987287,
//   "yo": 45.549660802959366,
//   "xf": 31.735916406012713,
//   "yf": 44.450339197040634,
//   "zt": 0,
//   "radius": 50000
// };
//
// this.analyzeViewshed(xyzXoYoXfYf, function (data) {
//   console.log('PATH', data);
// });

// exports.saveData([[1, 2, 3], [4, 5, 6]], {yo: 0, xo: 0}, 'testFile', () => console.log('success'));

exports._private = {
  calculateBlockSize,
  getPixels,
  makeBlock,
  findDatasetIndex,
  // getTrueLat,
  // getTrueLon,
  concat2d,
  makeVector,
  roundPixels,
  det,
  parseToPrecision12,
  // getDataset,
  generateFileName,
  // readDataset,
  prettyPoint,
  // saveData,
  // returnExistingFile,
  // runViewshedAnalysis
};
