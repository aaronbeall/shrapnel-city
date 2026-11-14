// instance shot_mcStun on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	speed = 25;
	bounce = 0.35;
	drag = .95;
	damage = 3;
	stun = frameRate * 9;
	blastRange = 200;
	spinSpeed = 0//25;
	frag = "frag_mc";
	fragCount = 9;
	shakeStrength = 0;
	useFlash = true;
	
	/*function onDie(){
		makeZaps({_x:this._x, _y:this._y}, 30);
	}*/
}
