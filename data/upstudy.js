"use strict";

let DataService = function($window, $rootScope, $http) {
  this.window = $window;
  this.rootScope = $rootScope;

  // relay messages from the addon to the page
  self.port.on("message", message => {
    this.rootScope.$apply(_ => {
      this.rootScope.$broadcast(message.content.topic, message.content.data);
    });
  });
}

DataService.prototype = {
  send: function _send(message) {
    self.port.emit(message);
  },
}

let studyDbgMenu = angular.module("studyDebugMenu", []);
studyDbgMenu.service("dataService", DataService);

studyDbgMenu.controller("studyCtrl", function($scope, dataService) {
  /** controller helpers **/
  $scope._setPrettified = function(value) {
    let storedValue = sessionStorage.getItem("prettifiedOutput");
    if (storedValue != value) {
      sessionStorage.setItem("prettifiedOutput", value);
    }
    $scope.prettifiedOutput = value;
  }

  $scope._getPrettifiedFlag = function() {
    let storedValue = sessionStorage.getItem("prettifiedOutput");
    if (storedValue == "true") {
      return true;
    }
    return false;
  }

  $scope.prettifyText = function(json) {
    return JSON.stringify(JSON.parse(json), null, "  ");
  }

  $scope.uglifyText = function(json) {
    return JSON.stringify(JSON.parse(json));
  }

  $scope._initialize = function () {
    $scope.historyComputeInProgress = false;
    $scope.historyComputeComplete = false;
    $scope.emptyMessage = "Your History was not analysed, please run the Full History Analysis.";
    $scope.rankingData = null;
    $scope.hasHistoryData = false;
    $scope.dispatchBatch = null;
    $scope.dispatchBatchNotSendable = true;
    $scope.dispatchInProgress = false;
    $scope.dispatchSuccess = null;
    $scope.dispatchError = null;
    $scope.daysLeft = null;
    $scope._setPrettified($scope._getPrettifiedFlag());
  }
  $scope._initialize();

  /** UI functionality **/

  $scope.processHistory = function() {
    $scope._initialize();
    dataService.send("history_process");
    $scope.historyComputeInProgress = true;
    $scope.dispatchBatchNotSendable = true;
  }

  $scope.runSurvey = function() {
    dataService.send("survey_run");
  }

  $scope.dispatchRun = function() {
    dataService.send("dispatch_run");
    $scope.dispatchBatchNotSendable = true;
    $scope.dispatchInProgress = true;
    $scope.dispatchSuccess = null;
    $scope.dispatchError = null;
  }

  $scope.dispatchGetNext = function() {
    dataService.send("dispatch_get_next");
    $scope.dispatchBatchNotSendable = true;
  }

  $scope.$on("dispatch_success", function(event, data) {
    $scope.dispatchSuccess = data;
    $scope.dispatchInProgress = false;
    $scope.dispatchGetNext();
  });

  $scope.$on("dispatch_error", function(event, data) {
    $scope.dispatchError = data;
    $scope.dispatchInProgress = false;
  });

  $scope.$on("days_left", function(event, data) {
    $scope.daysLeft = data;
  });

  $scope.$on("ranking_data", function(event, data) {
    if (data != null) {
      let textdata;
      if ($scope.prettifiedOutput) {
        textdata = JSON.stringify(data, null, "  ");
      }
      else {
        textdata = JSON.stringify(data);
      }
      $scope.rankingData = textdata;
    }
    else {
      $scope.emptyMessage = "Unable to detect interests in your history. Please run the History Analysis after few days of browsing.";
    }
    $scope.historyComputeComplete = true;
    $scope.historyComputeInProgress = false;
  });

  $scope.$on("dispatch_batch", function(event, data) {
    if (data != null) {
      let textdata;
      if ($scope.prettifiedOutput) {
        textdata = JSON.stringify(data, null, "  ");
      }
      else {
        textdata = JSON.stringify(data);
      }
      $scope.historyComputeComplete = true;
      $scope.rankingComputeInProgress = false;
      $scope.dispatchBatch = textdata;
      if (Object.keys(data.interests).length > 0) {
        $scope.dispatchBatchNotSendable = false;
      }
    }
  });

  $scope.selectText = function(selector) {
    let elem = document.querySelector(selector);
    if (elem) {
      let range = document.createRange();
      let sel = window.getSelection();
      range.selectNodeContents(elem);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  $scope.togglePrettify = function() {
    if ($scope.prettifiedOutput) {
      $scope.rankingData = $scope.uglifyText($scope.rankingData);
      $scope.dispatchBatch = $scope.uglifyText($scope.dispatchBatch);
    }
    else {
      $scope.rankingData = $scope.prettifyText($scope.rankingData);
      $scope.dispatchBatch = $scope.prettifyText($scope.dispatchBatch);
    }
    $scope._setPrettified(!$scope.prettifiedOutput);
  }
});

angular.bootstrap(document, ['studyDebugMenu']);

self.port.on("style", function(file) {
  let link = document.createElement("link");
  link.setAttribute("href", file);
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("type", "text/css");
  document.head.appendChild(link);
});
