/**
 * Copyright 2014 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
var AWS = require('aws-sdk')
var when = require('when')
var brandId
var appId
var poolId
var fs = require('fs')
var sFunction = require('./lib/awsStepFunction')
var apiGateway = require('./lib/awsApiGateway')
var mysql = require('mysql')
const path = require('path')
var allMappingFunctions = [];
// set up connection to DB
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'wdev',
  port: 3306
})

var settings
var appname
var s3 = null
var s3BucketName = null
var endpointData = {}
const API_ID = 'haxlv8az0l'

function prepopulateFlows(resolve) {
  var params = {}
  params.Bucket = s3BucketName
  params.Key = appname + '/' + 'flow.json'
  s3.getObject(params, function (err, doc) {
    if (err) {
      var promises = []
      if (fs.existsSync(path.join(__dirname, '/defaults/flow.json'))) {
        try {
          var flow = fs.readFileSync(path.join(__dirname, '/defaults/flow.json'), 'utf8')
          var flows = JSON.parse(flow)
          console.log('>> Adding default flow')
          promises.push(stepFunction.saveFlows(flows))
        } catch (err) {
          console.log(err)
        }
      } else {
        console.log('>> No default flow found')
      }
      when.settle(promises).then(function () {
        resolve()
      })
    } else {
      resolve()
    }
  })
}

var stepFunction = {
  init: function (_settings) {
    settings = _settings
    s3BucketName = settings.awsS3Bucket
    appname = settings.awsS3Appname || require('os').hostname()
    AWS.config.region = settings.awsRegion || 'eu-west-1'
    brandId = settings.brand_id || process.env.BRAND_ID
    appId = settings.app_id || process.env.APP_ID
    poolId = settings.pool_id || process.env.POOL_ID
    return when.promise(function (resolve, reject) {
      s3 = new AWS.S3()
      var params = { Bucket: s3BucketName }
      s3.listObjects(params, function (err, data) {
        if (err) {
          console.error('s3s get bucket error ', err)
          s3.createBucket(params, function (err) {
            if (err) {
              reject('Failed to create bucket: ' + err)
            } else {
              prepopulateFlows(resolve)
            }
          })
        } else {
          prepopulateFlows(resolve)
          resolve()
        }
      })
    })
  },

  getFlows: function () {
    return this.getArrayData('flow')
  },
  saveFlows: function (flows) {
    return this.saveData('flow', flows)
  },
  getCredentials: function () {
    return this.getData('credential')
  },
  saveCredentials: function (creds) {
    return this.saveData('credential', creds)
  },
  getSettings: function () {
    return this.getData('settings')
  },
  saveSettings: function (creds) {
    return this.saveData('settings', creds)
  },
  getData: function (entryType) {
    return when.promise(function (resolve, reject) {
      var params = {}
      params.Bucket = s3BucketName
      params.Key = appname + '/' + brandId + '/' + appId + '/' + entryType + '.json'
      s3.getObject(params, function (err, doc) {
        if (err) {
          if (err.code === 'NoSuchKey') {
            console.warn('no entry found for key ' + params.Key)
            resolve({})
          } else {
            console.error(err)
            reject(err.toString())
          }
        } else {
          var strObj = doc.Body.toString()
          var dataEntry = JSON.parse(strObj)
          resolve(dataEntry)
        }
      })
    })
  },
  getArrayData: function (entryType) {
    return when.promise(function (resolve, reject) {
      var params = {}
      params.Bucket = s3BucketName
      params.Key = appname + '/' + brandId + '/' + appId + '/' + entryType + '.json'
      s3.getObject(params, function (err, doc) {
        if (err) {
          if (err.code === 'NoSuchKey') {
            console.warn('no entry found for key ' + params.Key)
            resolve([])
          } else {
            console.error(err)
            reject(err.toString())
          }
        } else {
          var strObj = doc.Body.toString()
          var dataEntry = JSON.parse(strObj)
          resolve(dataEntry)
        }
      })
    })
  },
  saveData: function (entryType, dataEntry) {
    console.log('Save flow...')
    var arrayNodeType = []
    pool.getConnection((err, con) => {
      if (err) throw err
      var sql = 'SELECT n.name as node_name,np.Id as permission_id from nodes as n,node_permission as np where n.Id = np.node_id'
      con.query(sql, (error, res) => {
        if (error) throw error
        else if (res.length > 0) {
          res.forEach(function (data) {
            arrayNodeType[data.node_name] = data.permission_id
          })
        }
      })
    })

    return when.promise(function (resolve, reject) {
      var params = {}
      var promises = []
      var arraySelectNodeType = []
      var arrayUniqueType = []
      params.Bucket = s3BucketName
      params.Key = appname + '/' + brandId + '/' + appId + '/' + entryType + '.json'
      params.Body = JSON.stringify(dataEntry)

      s3.upload(params, function (err, doc) {
        if (err) {
          reject(err.toString())
        } else {
          if (dataEntry && Array.isArray(dataEntry) && entryType === 'flow') {
            // Fetch node data from db and set with dynamic create node for insert in db
            var i = 0
            dataEntry.forEach(function (element) {
              if (arrayNodeType[element.type]) {
                arraySelectNodeType[i] = arrayNodeType[element.type]
                i++
              }
            })
            var unique = (value, index, self) => {
              return self.indexOf(value) === index
            }
            var uniqueSelectNode = arraySelectNodeType.filter(unique)
            var j = 0
            uniqueSelectNode.forEach(function (element) {
              arrayUniqueType[j] = [appId, element]
              j++
            })
            getLambdaMappings().then((vals) => {
              console.log('vals is ', vals);
              sFunction.convert(dataEntry, vals).then(function (definitions) {
                definitions.forEach((def) => {
                  promises.push(sFunction.save(def))
                })
                when.all(promises).then(data => {
                  endpointData = data
                  apiGateway.prepare(dataEntry, endpointData, definitions).then(preparedData => {
                    apiGateway.create(preparedData, API_ID, brandId, appId, poolId, appname, s3BucketName).then(finalData => {
                      resolve(finalData)
                      pool.getConnection((err, con) => {
                        var sql = 'DELETE from asset_permission WHERE asset_id =' + appId
                        con.query(sql, (error, res) => {
                          if (error) throw error
                          else {
                            var sql = 'INSERT INTO asset_permission (asset_id, node_permission_id) VALUES ?'
                            con.query(sql, [arrayUniqueType], (err, result => {
                              if (err) throw err
                              else {
                                var energy = arraySelectNodeType.join()
                                // Delete unnecessary permission from role
                                var sqlQuery = 'DELETE FROM asset_role_permission WHERE permission_id  NOT IN (' + energy + ') AND asset_id = ' + appId
                                con.query(sqlQuery, (err, data => {
                                  if (err) throw err
                                  con.release()
                                }))
                              }
                            }))
                          }
                        })
                      })
                    })
                  })
                })
              })

            });
          } else {
            resolve()
          }
        }
      })
    })
  },
  saveLibraryEntry: function (type, path, meta, body) {
    console.log('save library entry: ' + type + ':' + path)
    if (path.substr(0) !== '/') {
      path = '/' + path
    }
    var key = appname + '/lib/' + type + path
    return when.promise(function (resolve, reject) {
      var params = {}
      params.Bucket = s3BucketName
      params.Key = key
      params.Body = JSON.stringify(body)
      if (meta) {
        var metaStr = JSON.stringify(meta)
        params.Metadata = { nrmeta: metaStr }
      }

      s3.putObject(params, function (err, data) {
        if (err) {
          reject(err.toString())
        } else {
          resolve()
        }
      })
    })
  },
  getLibraryEntry: function (type, path) {
    console.log('get library entry: ' + type + ':' + path)
    return when.promise(function (resolve, reject) {
      var params = {}
      params.Bucket = s3BucketName
      params.Prefix = appname + '/lib/' + type + (path.substr(0) !== '/' ? '/' : '') + path
      params.Delimiter = '/'
      s3.listObjects(params, function (err, data) {
        if (err) {
          if (err.code === 'NoSuchKey') {
            console.warn('no entry found for key ' + params.Key)
            reject(err.toString())
          } else {
            console.error(err)
            reject(err.toString())
          }
        } else {
          var getParams
          if (data.Contents.length === 1 && data.Contents[0].Key === data.Prefix) {
            getParams = { Bucket: s3BucketName, Key: data.Prefix }
            s3.getObject(getParams, function (err, doc) {
              if (err) {
                reject(err.toString())
              } else {
                var strObj = doc.Body.toString()
                var dataEntry = JSON.parse(strObj)
                resolve(dataEntry)
              }
            })
          } else {
            var resultData = []
            for (var i = 0; i < data.CommonPrefixes.length; i++) {
              var li = data.CommonPrefixes[i]
              resultData.push(li['Prefix'].substr(data.Prefix.length,
                li['Prefix'].length - (data.Prefix.length + 1)))
            }
            for (let i = 0; i < data.Contents.length; i++) {
              li = data.Contents[i]
              getParams = { Bucket: s3BucketName, Key: li.Key }
              s3.headObject(getParams, function (err, objData) {
                if (err) reject(err.toString())
                var entryName = this.request.httpRequest.path.toString()

                entryName = entryName.substr(data.Prefix.length + 1,
                  entryName.length - (data.Prefix.length + 1))
                var entryData = {}
                if (objData.Metadata['nrmeta']) {
                  entryData = JSON.parse(objData.Metadata.nrmeta)
                }

                entryData.fn = entryName
                resultData.push(entryData)
                if (resultData.length === (data.CommonPrefixes.length + data.Contents.length)) {
                  resolve(resultData)
                }
              })
            }
          }
        }
      })
    })

  },


}
var getLambdaMappings = async function () {
  return new Promise(resolve => {
    fs.readFile('/usr/src/node-red/package.json', 'utf8', function (err, contents) {
      console.log(contents);
      if ( contents !== undefined || contents !== 'undefined') {
        allMappingFiles = Object.keys(JSON.parse(contents).dependencies);
        var promises = []
        allMappingFiles.forEach((listItem) => {
          const path = '/usr/src/node-red/node_modules/' + listItem.trim() + '/mapping.json';
          // const tempPath = '../nodered-docker/mapping.json';

          promises.push(fileReader(path));
        })
        var finalObject = null;
        when.all(promises).then((data) => {
          finalObject = Object.assign({}, ...data);
          finalObject['http response'] = 'arn:aws:lambda:us-east-1:133013689155:function:wdev-lambda-crudwerp';
          resolve(finalObject)
        })
      }else{
        console.log('content is undefined');
      }
    });
  });

}


function fileReader(tempPath) {
  return new Promise(resolve => {
    fs.readFile(tempPath, 'utf8', function (err, contents) {
      if (contents !== undefined && contents !== 'undefined') {
        resolve(JSON.parse(contents));
      } else {
        console.log('dependency: ', tempPath, ' had no mapping file');
        resolve();
      }

    });
  });
}
module.exports = stepFunction
