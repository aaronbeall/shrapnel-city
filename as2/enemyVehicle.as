// ENEMY VEHICLE
// moving enemy: movement AI behaviors, pathfinding, locomotion graphics

#include "enemyTurret.as"

// init
_name = "enemyVehicle_mc" + getDepth();
movable = true;
core_mc.cacheAsBitmap = false;
locomotion_mc.stop();
if(!locomotion_mc)
	deathRoll = !random(2);

// params
if(accel == undefined) accel = .5;

// behaviors
if(chaser == undefined) chaser = false;
if(chaseDistance == undefined) chaseDistance = 150;
if(strafer == undefined) strafer = false;
if(strafeAccel == undefined) strafeAccel = .2;
if(strafeRate == undefined) strafeRate = 1;
if(wanderer == undefined) wanderer = false;
if(wanderSamples == undefined) wanderSamples = hunter ? 1 : 5;
if(hunter == undefined) hunter = false;
if(patroller == undefined) patroller = false;
if(alerter == undefined) alerter = hunter || patroller;
if(suicidal == undefined) suicidal = false;
if(suicideDistance == undefined) suicideDistance = radius;
if(suicideTimeLimit == undefined) suicideTimeLimit = 3 * frameRate;
if(suicideDamage == undefined) suicideDamage = 10;

// movement params
if(pathID == undefined) pathID = "auto";
if(moveMinDistance == undefined) moveMinDistance = (hunter || patroller) ? 10 : 50;
if(chaser && suicidal)
	chaseDistance = Math.min(chaseDistance, suicideDistance);

// vars
var strafeTime = 0;
var moveTarget = null;
var path = null;
var patrolDirection = patrolDirection || 1;
var patrolIndex = 0;
var patrolLoop = false;
var suicideTime = 0;
var PLAYER_DETECTED = "playerDetected";

// path setup
if(pathID == "auto" && (hunter || patroller))
	pathID = new Color(findClosestNode(this)).getRGB();

// hunter alert response setup
if(hunter){
	registerTrigger(this, PLAYER_DETECTED);
	onTrigger = function(id){
		if(id == PLAYER_DETECTED){
			var node = findClosestNode(this);
			var targetNode = findClosestNode(_player);
			if(targetNode != path[path.length - 1]){
				path = node.findPathTo(targetNode);
				path.push({_x:_player._x, _y:_player._y});
				//drawPath();
				while(path.length && lineOfSight(this, path[0], LOS_SAMPLE_SIZE))
					moveTarget = path.shift();
			}
		}
	}
}

// patroller path setup
if(patroller){
	
	// patrollers can't hunt or wander
	hunter = false;
	wanderer = false;
	
	// build patrol path
	var node = moveTarget = findClosestNode(this);
	var path = [node];
	var nodes = _root.paths[pathID];
	while(node = node.getNextNode(path))
		path.push(node);
	
	// check for patrol path looping
	var firstNode = path[0];
	var lastNode = path[path.length - 1];
	for(var i in lastNode.connections){
		if(lastNode.connections[i] == firstNode){
			patrolLoop = true;
			break;
		}
	}
	//drawPath();
}

// vehicle AI
__update = update;
update = function(time){
	__update(time);
	
	// locomotion graphics
	if(locomotion_mc && speed > speedMin){
		var f = locomotion_mc._currentframe;
		var d = int(speed * time * frameRate);
		f = 1 + (f - 1 + d) % locomotion_mc._totalframes;
		locomotion_mc.gotoAndStop(f);
	}
	
	// stunned vehicles disable AI behaviors
	if(stunned || dying)
		return;
		
	// basic move action
	var distance;
	if(moveTarget){
		targetRotation = getAngle(this, moveTarget);
		if(_rotation != targetRotation)
			_rotation = smartRotation(_rotation, targetRotation, turnSpeed * time);
		if(_rotation == targetRotation){
			distance = getDistance(this, moveTarget);
			var minDistance = (attacking && chaser ? chaseDistance : moveMinDistance)
			if(distance > minDistance)
				thrust(accel, _rotation)
			else
				moveTarget = null;
		}
	}
	
	// attacking behaviors
	if(attacking){
		
		// chase behavior - move towards enemy position
		if(chaser){
			moveTarget = {_x:_player._x, _y:_player._y, isPlayer:true};
			if(hunter && path)
				path = null;
		}
		
		// special case: patrollers without a turret gun have to stop moving and face player to shoot
		if(patroller && !turret_mc && !chaser && moveTarget)
			moveTarget = null;
		
		// strafe behavior - oscillate perpendicular to player
		if(strafer){
			if(_rotation == targetRotation && (!chaser || distance < chaseDistance)){
				strafeTime += strafeRate / frameRate;
				thrust(strafeAccel * Math.sin(strafeTime), _rotation - 90);
			}
		}
		
		// alerter behavior - triggers hunters to pathfind to player
		if(alerter){
			if(!hasAlerted){
				hasAlerted = true;
				trigger(PLAYER_DETECTED);
			}
		}
		
		// suicidal behavior - self-destruct after time-limit and/or proximity to player
		if(suicidal){
			if(distance == undefined) distance = getDistance(this, moveTarget);
			if(++suicideTime >= suicideTimeLimit || distance < Math.max(suicideDistance, _player.speed + radius + _player.radius)){
				if(moveTarget.isPlayer && suicideDamage)
					_player.hitPlayer(getDamage(suicideDamage), _rotation);
				hit(health, _rotation);
			}
		}
		
	}else{
		
		// reset alerter
		if(hasAlerted)
			hasAlerted = false;
	}
	
	// movement AI, turrets allow move and attack at same time
	if(!attacking || turret_mc){
		
		// hunter behavior - performs pathfinding
		if(hunter){
			if(!path.length){
				if(!moveTarget && wanderer){
					// hunter-wanderer pathfinds to random map locations
					var node = findClosestNode(this);
					var nodes = _root.paths[pathID];
					var targetNode = nodes[random(nodes.length)];
					path = node.findPathTo(targetNode);
					//drawPath();
					moveTarget = path.shift();
				}
			}else if(!moveTarget){
				//drawPath();
				moveTarget = path.shift();
			}
		}
		
		// patroller behavior - follows sequence of path nodes
		if(patroller){
			if(!moveTarget){
				patrolIndex += patrolDirection;
				if(patrolIndex >= path.length || patrolIndex < 0){
					if(patrolLoop)
						patrolIndex -= path.length * patrolDirection;
					else{
						patrolIndex -= patrolDirection;
						patrolDirection *= -1;
						patrolIndex += patrolDirection;
					}
				}
				moveTarget = path[patrolIndex];
			}
		}
		
		// wanderer behavior - pick random angles and move
		if(wanderer){
			if(!moveTarget){
				var i = wanderSamples, furthest = 0;
				while(i-- && random(10)){
					var a = rand(360);
					var v = getVector(LOS_SAMPLE_SIZE, a);
					var vx = _x, vy = _y, d = 0;
					while(!wallHitTest(vx, vy, impassThreshold)){
						d += LOS_SAMPLE_SIZE;
						vx += v.x;
						vy += v.y;
					}
					if(d > furthest){
						furthest = d;
						moveTarget = {_x:vx, _y:vy};
					}
				}
			}
		}
	}
}

function findClosestNode(targetMC){
	var nodes = _root.paths[pathID] || _screen;
	var node = null, distance = Infinity;
	for(var i in nodes){
		var n = nodes[i];
		if(!n.isNode)
			continue;
		var d = getDistanceSquare(n, targetMC);
		if(d < distance && lineOfSight(targetMC, n, LOS_SAMPLE_SIZE)){
			node = n;
			distance = d;
		}
	}
	return node;
}

onWallHit = function(){
	if(!attacking && moveTarget && !lineOfSight(this, moveTarget, LOS_SAMPLE_SIZE)){
		if(hunter){
			var node = findClosestNode(this);
			var nodes = _root.paths[pathID];
			var targetNode = findClosestNode(moveTarget);
			path = node.findPathTo(targetNode);
			path.push(moveTarget);
			//drawPath();
			while(path.length && lineOfSight(this, path[0], LOS_SAMPLE_SIZE))
				moveTarget = path.shift();
		}else
			moveTarget = null;
	}
}

// debug path drawing
function drawPath(){
	var mc = _root.createEmptyMovieClip("pathmc" + _name, getDepth() + 23456789);
	if(!pathDrawColor)
		pathDrawColor = 0xffffff * Math.random();
	mc.lineStyle(3, pathDrawColor);
	mc.moveTo(_x, _y);
	for(var i = 0; i < path.length; i++)
		mc.lineTo(path[i]._x, path[i]._y);
}
function clearPathDrawing(){
	_root["pathmc" + _name, getDepth() + 23456789].removeMovieClip();
}