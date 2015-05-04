'use strict';

var fs = require('fs'),
  path = require('path'),
  uuid = require('uuid'),
  rmdir = require('rimraf'),
  tar = require('tar'),
  eventsource = require('eventsource'),
  request = require('request'),
  createSandbox = require('./ScionSandbox'),
  redis = require('redis'),
  url = require('url'),
  debug = require('debug')('SCXMLD-stateless-remote-simulation-provider'),
  sendAction = require('./sendAction');


if (process.env.REDIS_URL) {
  var rtg = url.parse(process.env.REDIS_URL);
  var redisSubscribe = redis.createClient(rtg.port, rtg.hostname);

  if(rtg.auth) redisSubscribe.auth(rtg.auth.split(':')[1]);
} else {
  redisSubscribe = redis.createClient();
}

var instanceSubscriptions = {};

module.exports = function (db) {

  function completeInstantly () {                 
    //Call last argument                          
    arguments[arguments.length -1]();             
  }           

  var server = {};

  redisSubscribe.on("message", function (instanceIdChannel, message) {
    var event = JSON.parse(message);
    var subscriptions = instanceSubscriptions[instanceIdChannel];

    if(!subscriptions) return;

    subscriptions.forEach(function (response) {
      response.write('event: ' + event.name +'\n');
      response.write('data: ' + event.data + '\n\n');
    });
  });

  
  function getStatechartName (instanceId) {
    return instanceId.split('/')[0]; 
  }

  server.createStatechartWithTar = function (chartName, pack, done) {
    //TODO: unpack tar into ceph
  };

  function react (instanceId, snapshot, event, done) {

    var chartName = getStatechartName(instanceId);

    redisSubscribe.subscribe(instanceId);   //TODO: tear down the subscription if, on unsubscribe, we have no more open subscriptions for that instance. 

    debug('sending event to',
      process.env.SCION_SANDBOX_URL,
      {
          snapshot: snapshot,
          instanceId: instanceId,
          event: event
      });

    request({
      url: process.env.SCION_SANDBOX_URL,
      method: 'POST',
      json: {
        snapshot: snapshot,
        instanceId: instanceId,
        event: event
      }
    }, function(err, res, result) {
      debug(process.env.SCION_SANDBOX_URL,'response',err, result);

      if(err){ 
        debug('err',err);
        return done(err);
      }
      if(res.statusCode !== 200){
        return done(new Error('Received error response from simulation server: ' + res.statusCode));
      }

      //TODO: save event to database.
      //TODO: save instance to database
      debug ('conf',result.conf);
      done(null, result.conf);

      result.sendList.forEach(function (sendItem) {
        sendAction.send(sendItem.event, sendItem.options);
      });

      result.cancelList.forEach(function (cancelItem) {
        sendAction.cancel(cancelItem.sendid);
      });
    });
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
        debug(err, snapshot);
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

  server.getInstanceSnapshot = completeInstantly;
  server.deleteInstance = completeInstantly;

  server.deleteStatechart = completeInstantly;

  return server;
};
