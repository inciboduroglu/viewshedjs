let fs = require('fs');

exports.checkFileExists = function (filePath) { // note move to file helper
  // let fs = require('fs');
  return fs.existsSync(filePath);
};

exports.readDirectory = function (directory) { // note move to file helper
  const fs = require('fs');
  const fileNames = [];

  fs.readdirSync(directory).forEach(fileName => {
    fileNames.push(fileName);
  });

  return fileNames;
};

/* istanbul ignore next */
exports.writeArrayToFile = function (array, fileName) { // note move to file helper
  fs.writeFileSync(fileName, JSON.stringify(array))
};
