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

  server.createStatechartWithTar = function (chartName, pack, done) {
    return done({ statusCode: 501 });
  };

  function react (instanceId, snapshot, event, done) {
    var chartName = getStatechartName(instanceId);

    db.getStatechart(chartName, function (err, scxmlString) {
      if(err) return done(err);
      if(!scxmlString) return done({ statusCode: 404});

      createAndStartInstance(scxmlString);
    });
    
    function createAndStartInstance (scxmlString) {
      //Instance ready to query here.
      startListening(function(err, eventSource) {
        if(err) return done(err);

        request({
          url: process.env.SCION_SANDBOX_URL + '/react',
          method: 'POST',
          json: {
            snapshot: snapshot,
            instanceId: instanceId,
            event: event,
            scxml: scxmlString
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

          setTimeout(function () {
            eventSource.close();
          }, 200);
        });
      });
    }

    function startListening(done) {
      var es = new eventsource(process.env.SCION_SANDBOX_URL + '/_changes');

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
        console.log(err, snapshot);
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

  server.createStatechart = completeInstantly;
  server.getInstanceSnapshot = completeInstantly;
  server.deleteInstance = completeInstantly;
  server.deleteStatechart = completeInstantly;

  return server;
};
