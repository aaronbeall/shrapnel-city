// instance frag_mc on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	type = "shrapnel";
	speed = rand(100);
	bounce = 0.5;
	spinSpeed = 0;
	drag = .7;
	fastBounce = true;
	
	onInit = onUpdate = function(){
		_yscale = speed;
	}
	
	function onBounce(){
		_rotation = getAngle({_x:0, _y:0}, {_x:trajectory.x, _y:trajectory.y});
	}
	
	function onDie(){
		this.removeMovieClip();
	}
}
