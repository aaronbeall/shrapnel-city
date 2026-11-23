// instance shot_mcBuster on screen_mc, frame 2: the Bunker Buster (level 08 Bunker). A heavy,
// slow bomb that barely bounces and goes off with a huge blast and a ring of shrapnel.
onClipEvent(load){
	// params
	speed = 17;
	bounce = 0.15;
	drag = .9;
	damage = 650;
	blastRange = 170;
	spinSpeed = 10;
	blastMark = 2;
	blastInit = {scale:[190, 190]};
	frag = "shrap_mc";
	fragCount = 24;
	shakeStrength = 9;
	useFlash = true;
}
