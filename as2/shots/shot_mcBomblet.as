// instance shot_mcBomblet on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	type = "bomblet";
	speed = 15 + rand(15);
	bounce = 0.35;
	drag = .85;
	damage = 50;
	blastRange = 75;
	spinSpeed = 25;
	blastMark = 2;
	blastInit = {scale:[50,50]};
	sampleSize = 5;
}
