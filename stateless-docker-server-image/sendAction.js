'use strict';

var request = require('request');
var _ = require('underscore');

function sendEventToSelf(event){
  var selfUrl = process.env.SEND_URL + event.origin;

  console.log('selfUrl', selfUrl);

  request({
    method : 'POST',
    json : event,
    url : selfUrl
  },function(error, response){
    if(error) console.error('error sending event to server', error || response.body);
  });
}

module.exports = function (event, options) {
  console.log('customSendEvent', event, options);
	var n;

  switch(event.type) {
    case 'http://www.w3.org/TR/scxml/#SCXMLEventProcessor':
      //normalize to an HTTP event
      //assume this is of the form '/foo/bar/bat'
    case 'http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor':
      //Pass delay information to server
      event.delay = options.delay;

      if(!event.target) {
        n = function () {
          sendEventToSelf(event);
        };
      } else {
        n = function(){
          request({
            method : 'POST',
            json : event,
            url : event.target
          },function(error, response, body ) {
            if(error){
              sendEventToSelf(_.extend(event, { name : 'send.' + event.sendid + '.got.error',  data : error }));
            }else{
              sendEventToSelf(_.extend(event, {
                name : 'send.' + event.sendid + '.got.success', 
                data : {
                  body : body,
                  response : response
                }
              })); 
            }
          });
        };
      }

      break;
    default:
      console.log('wrong processor', event.type);
      break;
  }

  n();
};