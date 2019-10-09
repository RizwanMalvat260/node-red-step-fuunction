const http = require('http');
var fs = require('fs');

const hostname = '127.0.0.1';
const port = 3000;
var allMappingFiles = [];
var allMappingFunctions = [];

const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello World\n');
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
    console.log('HJi');

    fs.readFile('../nodered-docker/package.json', 'utf8', function (err, contents) {
        allMappingFiles = Object.keys(JSON.parse(contents).dependencies);
        console.log(allMappingFiles);
        for (var i = 0; i < allMappingFiles.length; i++) {
            const path = '/usr/src/node-red/node_modules/' + allMappingFiles[i].trim() + '/mapping.json';
            const tempPath = '../nodered-docker/mapping.json';
            console.log(path);
            console.log('temp path is ' + tempPath);
            fs.readFile(path, 'utf8', function (err, contents) {
                if (contents !== undefined && contents !== 'undefined') {
                    allMappingFunctions.push(contents);
                } else {
                    console.log('dependency: ' + path + ' had no mapping file');
                }
            });
        }

    });

    console.log('after calling readFile');
});
// const http = require('http');
// var fs = require('fs');

// const hostname = '127.0.0.1';
// const port = 3000;

// const server = http.createServer((req, res) => {
//     res.statusCode = 200;
//     res.setHeader('Content-Type', 'text/plain');
//     res.end('Hello World\n');
// });
// server.listen(port, hostname, () => {
//     console.log(`Server running at http://${hostname}:${port}/`);
//     console.log('HJi');


//     var input = fs.createReadStream('../nodered-docker/Dockerfile');
//     readLines(input, func);

//     console.log('after calling readFile');
//     function readLines(input, func) {
//         var remaining = '';

//         input.on('data', function (data) {
//             remaining += data;
//             var index = remaining.indexOf('\n');
//             while (index > -1) {
//                 var line = remaining.substring(0, index);
//                 remaining = remaining.substring(index + 1);
//                 func(line);
//                 index = remaining.indexOf('\n');
//             }
//         });

//         input.on('end', function () {
//             if (remaining.length > 0) {
//                 func(remaining);
//             }
//         });
//     }

//     function func(data) {
//         if (String(data).search('mapping.json') != -1) {
//             const splitData = data.split(' ');
//             for (var i = 0; i < splitData.length; i++) {
//                 if (splitData[i].trim().search('mapping.json') != -1) {
//                     allMappingFiles.push(splitData[i].trim());
//                     console.log(splitData[i].trim());
//                     fs.readFile(splitData[i].trim(), 'utf8', function(err, contents) {
//                         console.log(contents);
//                     });
//                 }
//             }
//         }
//     }

// });
