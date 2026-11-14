// instance shot_mcSuperLaserBomb on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	speed = 25;
	bounce = 0.35;
	drag = .95;
	spinSpeed = 25;
	frag = "shot_mcSuperLaser";
	fragCount = 25;
	
	// function for when the bomb goes off
	function hitFunc(){
		_rotation = rand(360);
		gotoAndPlay(2);
		die();
		
		// shoot out targetted lasers
		// target enemies first
		var targets = [];
		var i = _root.enemies.length, mc;
		while(i--){
			mc = _root.enemies[i];
			if(lineOfSight(this,mc,10)){
				targets.push({mc:mc,distance:getDistanceSquare(this,mc)});
				if(targets.length >= fragCount) break;
			}
		}
		// prioritize by closest
		targets.sort(function(a,b){return a.distance-b.distance});
		if(targets.length < fragCount){
			// traget boxes if not all potential lasers have a target
			var boxTargets = [];
			var i = _root.boxes.length, mc;
			while(i--){
				mc = _root.boxes[i];
				if(lineOfSight(this,mc,10)){
					targets.push({mc:mc,distance:getDistanceSquare(this,mc)});
					if(targets.length >= fragCount) break;
				}
			}
			// prioritize by closest, but all boxes follow any enemies
			boxTargets.sort(function(a, b){ return a.distance - b.distance });
			targets = targets.concat(boxTargets);
		}
		// create the targetted lasers
		var len = Math.min(fragCount, targets.length);
		for(var i=0; i<len; i++){
			var d = shotID();
			var init = {
				_x:_x,
				_y:_y,
				_rotation:getAngle(this,targets[i].mc),
				fadeSpeed:35
			}
			_screen[frag].duplicateMovieClip('shot_mc'+d,d,init);
			_root.shots.push(_root['shot_mc'+d]);
		}
	}
}
