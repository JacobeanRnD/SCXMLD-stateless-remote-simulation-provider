'use strict';

var fs = require('fs'),
  path = require('path'),
  uuid = require('uuid'),
  rmdir = require('rimraf'),
  tar = require('tar'),
  eventsource = require('eventsource'),
  request = require('request'),
  createSandbox = require('./ScionSandbox'),
  sendAction = require('./sendAction');

var imageName = 'jbeard4/stateless-docker-server-image';
var tmpFolder = 'tmp';
var instanceSubscriptions = {};

module.exports = function (db) {
  var server = {};
  
  function completeInstantly () {
    //Call last argument
    arguments[arguments.length -1]();
  }

  function getStatechartName (instanceId) {
    return instanceId.split('/')[0]; 
  }
  
   //Delete old temp folder
  //Create temporary folder for tar streams  
  rmdir.sync(tmpFolder);
  fs.mkdir(tmpFolder);

  server.createStatechartWithTar = function (chartName, pack, done) {
    var statechartFolder = path.join(tmpFolder, chartName);

    rmdir(statechartFolder, function (err) {
      if(err) return done(err);

      fs.mkdir(statechartFolder, function () {
        var extractor = tar.Extract({path: statechartFolder })
          .on('error', function (err) { done(err); })
          .on('end', function () {
            done();
          });

        //Route tar stream to our file system and finalize
        pack.pipe(extractor);
        pack.finalize();
      });
    });
  };

  server.createStatechart = function (chartName, scxmlString, done) {
    var statechartFolder = path.join(tmpFolder, chartName);

    rmdir(statechartFolder, function (err) {
      if(err) return done(err);

      //Create a local folder with statechartname
      fs.mkdir(statechartFolder, function () {
        //Put scxml contents as the main file name
        fs.writeFile(path.join(statechartFolder, 'index.scxml'), scxmlString, done);
      });
    });
  };

  function react (instanceId, snapshot, event, done) {
    var chartName = getStatechartName(instanceId);
    var statechartFolder = path.resolve(path.join(tmpFolder, chartName));

    fs.exists(statechartFolder, function (exists) {
      if(!exists) return done({ statusCode: 404 });

      createAndStartInstance();
    });
    
    function createAndStartInstance () {
      createSandbox({
        image: imageName,
        statechartFolder: statechartFolder
      }, function (error, sandbox) {
        //Instance ready to query here.
        startListening(sandbox, function(err, eventSource) {
          request({
            url: 'http://' + sandbox.ip + ':3000/react',
            method: 'POST',
            json: {
              snapshot: snapshot,
              id: instanceId,
              event: event
            }
          }, function(err, res, result) {
            if(err) return done(err);

            console.log('conf', result.conf);
            done(null, result.conf);

            result.sendList.forEach(function (sendItem) {
              sendAction.send(sendItem.event, sendItem.options);
            });

            result.cancelList.forEach(function (cancelItem) {
              sendAction.cancel(cancelItem.sendid);
            });

            //Cleanup
            setTimeout(function () {
              eventSource.close();

              sandbox.container.stop(function () {
                sandbox.container.remove(function () {});
              });
            }, 150);
          });
        });
      });
    }

    function startListening(sandbox, done) {
      var es = new eventsource('http://' + sandbox.ip + ':3000/_changes');

      es.addEventListener('subscribed', function () {
        console.log('subscribe done');
        done(null, es);
      }, false);
      es.addEventListener('onEntry', publishChanges('onEntry'), false);
      es.addEventListener('onExit', publishChanges('onExit'), false);
      es.onerror = function (e) {
        console.log('Eventsource error', e);
      };

      function publishChanges (eventName) {
        return function (stateId) {
          console.log(eventName, stateId.data);
          var subscriptions = instanceSubscriptions[instanceId];

          if(!subscriptions) return;

          subscriptions.forEach(function (response) {
            response.write('event: ' + eventName +'\n');
            response.write('data: ' + stateId.data + '\n\n');
          });
        };
      }
    }
  }

  server.createInstance = function (chartName, id, done) {
    var instanceId = chartName + '/' + (id || uuid.v1());

    done(null, instanceId);
  };

  server.startInstance = function (id, done) {
    react(id, null, null, done);
  };

  server.sendEvent = function (id, event, done) {
    var chartName = getStatechartName(id);

    if(event.name === 'system.start') {
      server.startInstance(id, done);
    } else {
      db.getInstance(chartName, id, function (err, snapshot) {
        react(id, snapshot, event, done);
      });
    }
  };

  server.registerListener = function (id, response, done) {
    instanceSubscriptions[id] = instanceSubscriptions[id] || [];

    instanceSubscriptions[id].push(response);

    done();
  };

  //This is a much needed interface on instance deletion
  server.unregisterAllListeners = function (id, done) {
    var subscriptions = instanceSubscriptions[id];

    if(!subscriptions) return done();

    subscriptions.forEach(function (response) {
      response.end();
    });

    delete instanceSubscriptions[id];

    if(done) done();
  };

  server.unregisterListener = function (id, response, done) {
    //instanceSubscriptions
    var subscriptions = instanceSubscriptions[id];

    if(!subscriptions) return done();
    //TODO: somehow remove using response object?
    //Any unique identifier in response?
    //http://stackoverflow.com/a/26707009/1744033
    instanceSubscriptions[id] = subscriptions.filter(function (subResponse) {
      if(response.uniqueId === subResponse.uniqueId) {
        response.end();
        return false;
      }

      return true;
    });

    if(done) done();
  };

  server.getInstanceSnapshot = completeInstantly;
  server.deleteInstance = completeInstantly;
  server.deleteStatechart = completeInstantly;

  return server;
};
