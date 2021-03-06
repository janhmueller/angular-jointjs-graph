'use strict';
angular.module('angular-jointjs-graph')
  .directive('graph', ['JointGraph', 'JointChartNode', 'JointElementView', 'JointNodeModel', 'JointPaper', '$q', 'GraphHelpers', 'GraphEntities', 'GraphLinks', 'GraphSelection', 'JointGraphResources',
    function(JointGraph, JointChartNode, JointElementView, JointNodeModel, JointPaper, $q, GraphHelpers, GraphEntities, GraphLinks, GraphSelection, JointGraphResources) {
      return {
        restrict: 'E',
        templateUrl: 'angular-joints-graph/templates/graph',
        transclude: true,
        controller: ['$scope', '$element', '$attrs',
          function($scope, $element) {
            $scope.$on('graphResources', function(event, data) {
              JointGraphResources.set(data);

              data.graph.$get().then(function(graph) {
                $scope.graph = graph;
                return Object.keys(data.entities).map(function(key) {
                  return { key: key, promise: GraphHelpers.queryResource(data.entities[key]) };
                }).reduce(function(prev, current) {
                  return prev.then(function(entitiesMap) {
                    return current.promise.then(function(array) {
                      entitiesMap[current.key] = array;
                      return entitiesMap;
                    });
                  });
                }, $q.when({}));
              }).then(function(entitiesMap) {
                GraphEntities.set(entitiesMap);
                $scope.$broadcast('graphEntitiesLoaded', entitiesMap);
                return GraphHelpers.queryResource(data.entityRelations);
              }).then(function(entityRelations) {
                GraphLinks.set(entityRelations);
                $scope.$broadcast('graphEntityRelationsLoaded', entityRelations);
              }).then(function() {
                $scope.$broadcast('graphResourcesLoaded');
                initGraph();
              }, function(error) {
                $scope.$emit('applicationError', { errData: error });
              });
            });

            function initGraph() {
              JointElementView.init($element.find('.chartContainer'));
              JointPaper.init($element.find('.chartArea'));
              JointPaper.onSelectionChange(function (ids) {
                GraphSelection.select(ids);
                $scope.$digest();
              });
              JointPaper.onCellPositionChange(function () {
                $scope.saveGraph();
              });

              JointGraph.on('add', function (cell) {
                if (cell.get('isChartNode')) {
                  cell.on('createLinkStart', createLinkStart);
                  cell.on('createLinkEnd', createLinkEnd);
                  cell.on('nodeRemoved', nodeRemoved);
                } else {
                  cell.on('remove', linkRemoved);
                }
              });

              addGraphCells();
            }

            function addGraphCells() {
              var graphContent = $scope.graph.content ?
                    JSON.parse($scope.graph.content) : {};

              if (graphContent.cells) {
                graphContent.cells.forEach(function(element) {
                  if (element.isChartNode) {
                    GraphEntities.markPresentOnGraph(element);
                  }
                });

                JointGraph.addCells(graphContent.cells);
              }
            }

            $scope.clearCellSelectionAndRevert = function() {
              GraphSelection.clearAndRevert();
            };

            $scope.revertSelection = function() {
              GraphSelection.revertSelection();
            };

            $scope.syncSelection = function() {
              GraphSelection.syncSelection();
            };

            $scope.selectEntity = function(entity, identifier) {
              GraphSelection.selectEntity(entity, identifier);
            };

            $scope.saveGraph = function() {
              setTimeout(function() {
                $scope.graph.content = JSON.stringify(JointGraph.toJSON());
                $scope.graph.$update().catch(function(data) {
                  $scope.$emit('applicationError', { errData: data });
                });
              }, 0);
            };

            function createLinkStart() {
              $scope.$apply(function() {
                GraphSelection.clearAndRevert();
              });
            }

            function createLinkEnd(linkId) {
              var link = JointGraph.getCell(linkId);

              $scope.$apply(function() {
                link.createResource().then(function(linkEntity) {
                  GraphLinks.addSingle(linkEntity);
                  $scope.saveGraph();
                }, function(data) {
                  $scope.$emit('applicationError', { errData: data });
                  link.remove({ skipCallbacks: true });
                });
              });
            }

            function nodeRemoved(event, model) {
              event.preventDefault();

              $scope.$apply(function() {
                var resource = GraphEntities.getSingle(model),
                    selectedResource = GraphSelection.getSelectedEntity();

                if (resource) {
                  if (resource === selectedResource) {
                    GraphSelection.clear();
                  }

                  GraphEntities.markRemovedFromGraph(model);
                  $scope.saveGraph();
                }
              });
            }

            $scope.$on('removeEntity', function(event, data) {
              event.stopPropagation();
              data.entity.$remove().then(function() {
                GraphEntities.remove(data.entity, data.identifier);
              }, function(errData) {
                $scope.$emit('applicationError', { errData: errData });
              });
            });

            function linkRemoved(cell, models, options) {
              if (options && options.skipCallbacks) {
                //Link is removed because of invalid target
              } else {
                var linkResource = GraphLinks.getSingle(cell);

                if (linkResource) {
                  linkResource.$remove().then(function() {
                    GraphLinks.remove(cell);
                    if (options && options.skipGraphSave) {
                      //When removing a node, the nodeRemoved callback saves the graph
                    } else {
                      $scope.saveGraph();
                    }
                  }, function(errData) {
                    $scope.$emit('applicationError', { errData: errData });
                  });
                }
              }
            }

            function updateResourceList(cellModel) {
              var deferred = $q.defer(),
                  modelId = cellModel.get('backendModelParams')[GraphHelpers.getModelIdKey()];

              if (modelId === 'undefined') {
                cellModel.createResource().then(function(resource) {
                  GraphEntities.addSingle(cellModel, resource);
                  deferred.resolve({ newNode: true });
                }, function(errData) {
                  deferred.reject(errData);
                });
              } else {
                GraphEntities.markPresentOnGraph(cellModel);
                deferred.resolve({ newNode: false });
              }

              return deferred.promise;
            }

            function highlightCell(cellModel) {
              var cellView = JointPaper.getPaper().findViewByModel(cellModel);
              JointPaper.clearSelection();
              GraphSelection.select(JointPaper.selectCell(cellView));
            }

            GraphSelection.onSelectionChange(function(selection) {
              $scope.$broadcast('graphSelection', selection);
            });

            $scope.$on('graphDropEvent', function(event, data) {
              event.stopPropagation();
              $scope.$apply(function() {
                var rect = JointChartNode.create(data.entityAttributes, data.dropPoint);
                JointGraph.addCell(rect);
                updateResourceList(rect).then(function(data) {
                    if(data.newNode) {
                      highlightCell(rect);
                    }

                    $scope.saveGraph();
                  },
                  function(data) {
                    $scope.$emit('applicationError', { errData: data });
                    rect.remove();
                  });
              });
            });
          }
        ]
      };
    }
  ]);
