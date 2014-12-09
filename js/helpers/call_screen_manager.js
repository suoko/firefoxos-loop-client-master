/* exported CallScreenManager */

'use strict';

(function(exports) {
  var debug = true;

  // Global flag to indicate that we are in a call and so we will be rejecting
  // any incoming call with the 'busy' state and forbiding any outgoing call
  // until we support multi-party calls.
  var _inCall = false;

  function _callback(cb, args) {
    if (cb && typeof cb === 'function') {
      cb.apply(null, args);
    }
  }

  function _ensureGum(frontCamera) {
    return new Promise(function(resolve, reject) {
      var mode = frontCamera ? 'user' : 'environment';
      var cameraConstraints = {facingMode: mode, require: ['facingMode']};

      navigator.mozGetUserMedia(
	 {
	   video: cameraConstraints,
	   audio: true
	 },
	 resolve,
	 reject
      );
    });
  }

  function _onAttentionLoaded(attention, callback) {
    if (typeof callback !== 'function') {
      console.error('Error when waiting for attention onload');
      return;
    }

    // Flag for handling both methods
    var isAttentionLoaded = false;

    // Method to use when available. Currently is not working
    // so tracked in bug XXX
    function _onloaded() {
      // Update flag
      isAttentionLoaded = true;
      _inCall = true;
      // Execute CB
      callback();
    }

    attention.onload = function() {
      _onloaded();
    };

    attention.onunload = function() {
      _inCall = false;
    };

    // Workaround while the bug is being fixed
    window.addEventListener(
      'message',
      function onPingMessageListener(event) {
        try {
          var pongObjectCandidate = JSON.parse(event.data);
          if (pongObjectCandidate.message === 'pong') {
            attention.onload = null;
            window.removeEventListener('message', onPingMessageListener);
            _onloaded();
          }
        } catch(e) {
          console.error('Message from iFrame not related with Loop ' + e);
        }
      }
    );

    // Function to fake the 'onload' method which is not working
    var pingMessage = {
      id: 'controller',
      message: 'ping'
    };

    function _fakeLoaded() {
      if (isAttentionLoaded) {
        return;
      }
      // Send to the attention screen
      attention.postMessage(JSON.stringify(pingMessage), '*');
      // Enable polling
      setTimeout(function() {
        _fakeLoaded();
      }, 20);
    }
    // Boot the fake loader
    _fakeLoaded();
  }

  var attention;

  function _closeAttentionScreen() {
    if (!attention) {
      return;
    }
    attention.close();
    attention = null;
  }

  function _launchAttention(type, params, incomingCall, contact) {
    // Retrieve the params and pass them as part of the URL
    var attentionParams = 'layout=' + type;
    if (params) {
      Object.keys(params).forEach(function(key) {
        attentionParams += '&' + key + '=' + encodeURIComponent(params[key]);
      });
    }

    // Launch the Attention
    var host = document.location.host;
    var protocol = document.location.protocol;
    var urlBase = protocol + '//' + host +
      '/call_screen/call.html?' + attentionParams;
    attention = window.open(urlBase, 'call_screen', 'attention');

    // Enable handshaking with the Call Screen
    _onAttentionLoaded(
      attention,
      function onLoaded() {
        // Function to post data from the server
        function _postCall(type, call, identities, frontCamera, video) {
          if (!attention) {
            return;
          }
          attention.postMessage(JSON.stringify({
            id: 'controller',
            message: 'call',
            params: {
              type: type,
              call: call,
              identities: identities,
              video: video || null,
              frontCamera: frontCamera || false
            }
          }), '*');
        }

        function _abortCall() {
          if (!attention) {
            return;
          }
          attention.postMessage(JSON.stringify({
            id: 'controller',
            message: 'abort'
          }), '*');
        }

        // Now it's time to send to the attention the info regarding the
        // call object
        switch(type) {
          case 'incoming':
            // Call was retrieved previously in order to accelerate the UI
            _postCall(type, incomingCall, params.identities, params.frontCamera);
            break;
          case 'outgoing':
            _ensureGum(params.frontCamera).then(function() {
              if (!params.token) {
                CallHelper.callUser(
                  params.identities,
                  params.video,
                  function onLoopIdentity(call) {
                    _postCall(type,
                              call,
                              params.identities,
                              params.frontCamera,
                              params.video);
                  },
                  function onFallback() {
                    _abortCall();
                    // Get URL to share and show prompt
                    CallHelper.generateCallUrl(params.identities[0],
                      function onCallUrlSuccess(result) {
                        var speaker = params.video && params.video === true;
                        Share.show(
                          result,
                          params.identities,
                          'notAUser',
                          function onShareScreen() {
                            _closeAttentionScreen();
                            TonePlayerHelper.init('telephony');
                            TonePlayerHelper.playFailed(speaker).then(
                              function onplaybackcompleted() {
                                TonePlayerHelper.stop();
                                TonePlayerHelper.releaseResources();
                            });
                        });
                      },
                      function(e) {
                        console.error('Unable to retrieve link to share ' + e);
                        _closeAttentionScreen();
                      }
                    );
                });
              } else {
                CallHelper.callUrl(
                  params.token,
                  params.video,
                  function(call, calleeFriendlyName) {
                    params.identities = [calleeFriendlyName];
                    _postCall(type, call, params.identities, params.video);
                  },
                  function() {
                    console.error('Unable to connect');
                    _closeAttentionScreen();
                  }
                );
              }
            });
            break;
        }

        var attentionLoadedDate = new Date();
        window.addEventListener(
          'message',
          function onHandShakingEvent(event) {
            try {
              var messageFromCallScreen = JSON.parse(event.data);
              if (messageFromCallScreen.id != 'call_screen') {
                debug && console.log('CallScreen: PostMessage not from CallScreen');
                return;
              }
              switch(messageFromCallScreen.message) {
                case 'hangout':
                  // Stop listener
                  window.removeEventListener('message', onHandShakingEvent);

                  // Create CALL object
                  var callscreenParams = messageFromCallScreen.params;

                  if (callscreenParams.error && callscreenParams.error.reason) {
                    switch (callscreenParams.error.reason) {
                      case 'gum':
                      case 'failed':
                        _closeAttentionScreen();
                        // If there is any error, as gUM permission, let's show
                        // to the user asap.
                        Controller.showError(callscreenParams.error.reason);
                        break;
                      case 'unavailable':
                        // Get URL to share and show prompt
                        CallHelper.generateCallUrl(params.identities[0],
                          function onCallUrlSuccess(result) {
                            Share.show(
                              result, params.identities, 'unavailable', _closeAttentionScreen
                            );
                          },
                          function(e) {
                            console.error(
                              'Unable to retrieve link to share ' + e
                            );
                            _closeAttentionScreen();
                          }
                        );
                        break;
                      default:
                        _closeAttentionScreen();
                        break;
                    }
                  } else {
                    _closeAttentionScreen();
                  }

                  // Create object to store
                  var callObject = {
                    date: attentionLoadedDate,
                    identities: params.identities || [],
                    video: params.video || callscreenParams.video || false,
                    type: type,
                    connected: callscreenParams.connected,
                    duration: callscreenParams.duration,
                    url: callscreenParams.call.callUrl || null,
                    urlToken: callscreenParams.call.callToken || null,
                    contactId: null,
                    contactPrimaryInfo: null,
                    contactPhoto: null
                  };

                  if (callscreenParams.feedback) {
                    LazyLoader.load([
                      '../js/helpers/metrics.js',
                      '../js/helpers/feedback.js'
                    ], function() {
                      var url = callscreenParams.call.callUrl;
                      if (url) {
                        // We include the URL that the user clicked on to
                        // initiate the call (without the call token) in the
                        // "url" field. The key reason for doing so is that
                        // it allows us to distinguish standalone feedback
                        // from build-in client feedback.
                        callscreenParams.feedback.url =
                          url.substring(0, url.lastIndexOf('/'));
                      }
                      Feedback.send(callscreenParams.feedback);
                    });
                  }

                  ContactsHelper.find({
                    identities: params.identities
                  }, function(result) {
                    CallLog.addCall(callObject, result);
                  }, function() {
                    CallLog.addCall(callObject);
                  });

                  break;
              }
            } catch(e) {}
          }
        );
      }
    );
  }

  function _rejectCall(call) {
    LazyLoader.load([
      '../js/helpers/call_progress_helper.js'
    ], function() {
      var callProgressHelper = new CallProgressHelper(call.callId,
                                                      call.progressURL,
                                                      call.websocketToken);
      callProgressHelper.terminate('busy');
    });
  }

  var CallScreenManager = {
    launch: function(type, params) {
      if (type !== 'incoming') {
        // If we are already on a call, we shouldn't allow calling another user
        // until we have a proper multi-party feature in place.
        // Bug 1058628 - Do not allow make a call while there is another one in
        // place
        if (_inCall) {
          return;
        }
        _launchAttention(type, params);
        return;
      }

      // In the case of an incoming call, we need to retrieve call params
      // for doing some checks before launching the attention.
      ClientRequestHelper.getCalls(
        params.version,
        function onsuccess(callsInfo) {
          debug && console.log('Version ' + params.version);
          debug && console.log('Calls from server ' + JSON.stringify(callsInfo));

          var callsToReject = [];
          var call;

          // In the case of an incoming call we will double check if the state
          // is not set, what it means that the call was never answered
          // and it's within the first 10 seconds. After the first 10 seconds,
          // this call object will not be available.
          for (var i = 0; i < callsInfo.calls.length; i++) {
            // If it's a new incoming call, there is no state. In the case
            // of having one call working at the moment, we need to reject
            // the new ones
            if (!callsInfo.calls[i].state) {
              if (_inCall || !!call) {
                callsToReject.push(callsInfo.calls[i]);
                continue;
              }
              call = callsInfo.calls[i];
            }
          }

          // If we are already in a call (outgoing or incoming) we can't
          // automatically attend the new incoming call without hanging up the
          // on in progress. In the future we might want to allow the user to
          // accept or reject it manually, but for now we simply reject it
          // with the busy state without launching the attention screen.
          // Reject the incoming extra calls, if any.
          for (var i = 0, l = callsToReject.length; i < l; i++) {
            _rejectCall(callsToReject[i]);
          }

          // If we have a valid incoming call, let's launch the attention screen.
          if (!call || _inCall) {
            return;
          }

          params.identities = [call.callerId];
          _launchAttention(type, params, call);
        },
        function onerror(e) {
          debug && console.error('Error: ClientRequestHelper.getCalls ' + e);
        }
      );
    },
    close: function() {
      _closeAttentionScreen();
    }
  };

  exports.CallScreenManager = CallScreenManager;
}(this));
