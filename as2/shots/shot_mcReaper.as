// instance shot_mcReaper on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent (load) {
	// params
	damage = 10;
	speed = 20;
	blastMark = 1;
	wallDrag = .9;
	
	blendMode = "invert";
	
	function update(){
		
		// sub sampled shot movement
		var i = samples;
		while(i--){
			
			// move shot
			_x += xSample;
			_y += ySample;
			
			// check for collisions
			if(wallHitTest(_x, _y)){
				//return hitFunc("wall");
				xSample *= wallDrag;
				ySample *= wallDrag;
				speed *= wallDrag;
			}else if(projectileHittest(this)){
				return hitFunc();
			}
		}
		
		if(Math.abs(xSample) < 3 && Math.abs(ySample) < 3)
			hitFunc();
		else if(_x < 0 || _x > levelWidth || _y < 0 || _y > levelHeight)
			hitFunc();
		_yscale = speed * 10;
	}
	function onDie(){
		_yscale = 100;
	}
}
