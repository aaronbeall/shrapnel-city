// instance shot_mcSmartMissile on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 600;
	speed = 5;
	accel = 1.1;
	blastRange = 50;
	blastMark = 11;
	fragCount = 12;
	//fragInfluence = -.1;
	frag = "shot_mcSmarty";
	
	function onSample(){
		makeSmoke(this, 35, 4);
	}
}
