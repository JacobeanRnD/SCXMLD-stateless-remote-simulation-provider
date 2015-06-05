'use strict';

var uuid = require('uuid'),
  request = require('request'),
  redis = require('redis'),
  url = require('url'),
  debug = require('debug')('SCXMLD-stateless-remote-simulation-provider'),
  sendAction = require('./sendAction');

if (process.env.REDIS_URL) {
  var rtg = url.parse(process.env.REDIS_URL);

  var redisSubscribe = redis.createClient(rtg.port, rtg.hostname);
  if(rtg.auth) redisSubscribe.auth(rtg.auth.split(':')[1]);

  var redisPublish = redis.createClient(rtg.port, rtg.hostname);
  if(rtg.auth) redisPublish.auth(rtg.auth.split(':')[1]);

} else {
  redisSubscribe = redis.createClient();
  redisPublish = redis.createClient();
}

//FIXME: maybe it's possible to publish directly to the redis channel
function respond(eventUuid, snapshot, customData){
  redisPublish.publish('/response/' + eventUuid, JSON.stringify({snapshot:snapshot, customData:customData}));
}

var instanceSubscriptions = {};   // instanceid -> response

module.exports = function (db) {

  function completeInstantly () {                 
    //Call last argument                          
    arguments[arguments.length -1]();             
  }           

  var server = {};

  redisSubscribe.on('message', function (instanceIdChannel, message) {
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

  function react (instanceId, snapshot, event, sendOptions, eventUuid, done) {

    var chartName = getStatechartName(instanceId);

    redisSubscribe.subscribe(instanceId);   //TODO: tear down the subscription if, on unsubscribe, we have no more open subscriptions for that instance. 

    if(event) event.uuid = eventUuid;   //tag the event with the uuid, if the event is non-null

    debug('sending event', JSON.stringify({
          snapshot: snapshot,
          instanceId: instanceId,
          event: event
      }));

    request({
      url: process.env.SCION_SANDBOX_URL,
      method: 'POST',
      json: {
        snapshot: snapshot,
        instanceId: instanceId,
        event: event
      }
    }, function(err, res, result) {
      debug('response',err, JSON.stringify(result));

      if(err){ 
        debug('err',err);
        return done(err);
      }
      if(res.statusCode !== 200){
        return done(new Error('Received error response from simulation server: ' + res.statusCode));
      }

      //TODO: save event to database.
      //TODO: save instance to database
      //debug ('conf',JSON.stringify(result.conf,4,4));
      //debug ('sendList',JSON.stringify(result.sendList,4,4));
      var targetRegex = /^scxml:\/\/response\/(.*)$/;
      var wait = false;
      result.sendList.forEach(function (sendItem) {
        if(sendItem.event.type === 'http://scxml.io/httpLifecycle'){
          var targetMatch = sendItem.event.target.match(targetRegex);
          if(!targetMatch && targetMatch.length) return done(new Error('Received malformed target url'));
          var target = targetMatch[1];

          //interpret this as special instructions to control the http response lifecycle
          if(sendItem.event.name === 'wait'){
            wait = true;
          }else if(sendItem.event.name === 'response'){
            respond(target, null, sendItem.event.data);
            wait = target === event.uuid;
          }
        } else {
          sendAction.send(sendItem.event, sendItem.options, sendOptions);
        }
      });

      result.cancelList.forEach(function (cancelItem) {
        sendAction.cancel(cancelItem.sendid);
      });

      done(null, result.conf);

      if(!wait){
        respond(eventUuid, result.conf);
      }
    });
  }

  server.createInstance = function (chartName, id, done) {
    var instanceId = chartName + '/' + (id || uuid.v1());

    done(null, instanceId);
  };

  server.startInstance = function (id, sendOptions, eventUuid, done) {
    react(id, null, null, sendOptions, eventUuid, done);
  };

  server.sendEvent = function (id, event, sendOptions, eventUuid, done) {
    var chartName = getStatechartName(id);

    if(event.name === 'system.start') {
      server.startInstance(id, sendOptions, eventUuid, done);
    } else {
      db.getInstance(chartName, id, function (err, snapshot) {
        react(id, snapshot, event, sendOptions, eventUuid, done);
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

  server.createStatechartWithTar = completeInstantly;
  server.createStatechart = completeInstantly;
  server.getInstanceSnapshot = completeInstantly;

  server.getInstanceSnapshot = completeInstantly;
  server.deleteInstance = completeInstantly;

  server.deleteStatechart = completeInstantly;

  return server;
};
