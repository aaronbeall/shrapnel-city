// PATH NODE
// defines waypoints and paths for pathfinding AI

// init
isNode = true;
id = int(_name.split(stripNums(_name)).join(""));
labelTxt.text = id;
var color = new Color(this).getRGB();
_visible = false;

// init node group
if(!_root.paths[color])
	_root.paths[color] = [];
_root.paths[color].push(this);

// auto-generate path connections from line of sight
if(!connections){
	connections = [];
	for(var i in _parent){
		var mc = _parent[i];
		if(mc != this){
			var col = new Color(mc).getRGB();
			if(col == color && lineOfSight(this, mc, 10))
				connections.push(mc);
		}
	}
}

// calculate node connection weights
var weights = [];
for(var i in connections)
	weights[i] = getDistance(this, connections[i]);

// debugging
if(_visible){
	lineStyle(1, color);
	for(var i in connections){
		var c = connections[i];
		moveTo(0, 0);
		lineTo(c._x - _x, c._y - _y);
	}
}

// find next node for chain path building
function getNextNode(excludeNodes){
	for(var i in connections){
		var node = connections[i], excluded = false;
		for(var n in excludeNodes){
			if(node == excludeNodes[n]){
				excluded = true;
				break;
			}
		}
		if(!excluded)
			return node;
	}
	return null;
}

// calculate a path to a destination using A* algorithm
function findPathTo(goalNode){
	var startNode = this;
	startNode.costFromStart = 0;
	startNode.costToGoal = getCost(startNode, goalNode);
	startNode.parentNode = null;
	var openNodes = [startNode];
	var closedNodes = [];
	var currentNode = startNode;
	
	var t = 500;
	
	// while OPEN is not empty
	while(openNodes.length && t--){
		//_root.lineStyle(1, 0xff0000, 50)
		//_root.moveTo(currentNode._x, currentNode._y);
		
		// 1. Remove the best node from OPEN, call it n, add it to CLOSED.
		var index = 0;
		for(var i in openNodes)
			if(openNodes[i].costToGoal < openNodes[index].costToGoal)
				index = i;
		currentNode = openNodes[index];
		openNodes.splice(index, 1);
		closedNodes.push(currentNode);
		//_root.lineTo(currentNode._x, currentNode._y);
		
		// 2. If n is the goal state, backtrace path to n (through recorded parents) and return path.
		if(currentNode == goalNode){
			var path = [goalNode];
			while(currentNode.parentNode){
				path.unshift(currentNode.parentNode);
				currentNode = currentNode.parentNode;
			}
			return path;
		}
		
		// 3. Create n's successors.
		var successors = currentNode.connections;
		
		// 4. For each successor do:
		for(var i in successors){
			var successorNode = successors[i];
			
			// Calculate estimate (cost + heuristic) for each node
			var cost:Number = currentNode.costFromStart + currentNode.weights[i];//getCost(currentNode, successorNode);
			
			// If successor is already in OPEN as a better path, skip it
			var isOpen = indexOf(openNodes, successorNode) != -1;
			if(isOpen && successorNode.costFromStart <= cost)
				continue;
			
			// If successor is in CLOSED and this is not a better path, skip it
			if(indexOf(closedNodes, successorNode) != -1 && successorNode.costFromStart <= cost)
				continue;
			
			// Evaluate costs, record parent and add to OPEN
			successorNode.costFromStart = cost;
			successorNode.costToGoal = cost + getCost(successorNode, goalNode);
			successorNode.parentNode = currentNode;
			if(!isOpen)
				openNodes.push(successorNode);
		}
	}
	
	trace("NO PATH SOLUTION " + startNode.id + " to " + goalNode.id + (t == -1 ? " - TIMED OUT" : ""))
	
	return null;
	
	function getCost(node1, node2){
		var xdif = node1._x - node2._x;
		var ydif = node1._y - node2._y;
		return Math.sqrt(xdif * xdif + ydif * ydif);
	}
	
	function indexOf(arr, elem){
		for(var i in arr)
			if(arr[i] == elem)
				return i;
		return -1;
	}
	
	function dumpNodes(nodes){
		var str = "";
		for(var i = 0; i < nodes.length; i++)
			str += (i != 0 ? "," : "") + nodes[i].id;
		trace(str)
	}
}