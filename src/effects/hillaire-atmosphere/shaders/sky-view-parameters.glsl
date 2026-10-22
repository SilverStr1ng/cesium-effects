// Vertical parameterization adapted from Sebastien Hillaire's 2020 sample.
// Copyright (c) 2020 Epic Games, Inc. MIT; see LICENSE.hillaire.
// Keep the full periodic azimuth used by this effect; concentrate vertical
// samples on the physical (depressed) planetary horizon, not elevation zero.
float skyHorizonAngle(float radius){
    return PI-acos(sqrt(max(0.,radius*radius-Rg*Rg))/max(Rg,radius));
}
vec3 skyViewDirection(vec2 unitUV,float radius){
    float horizon=skyHorizonAngle(radius),theta;
    if(unitUV.y<.5){float q=1.-2.*unitUV.y;theta=horizon*(1.-q*q);}
    else{float q=2.*unitUV.y-1.;theta=horizon+(PI-horizon)*q*q;}
    float azimuth=unitUV.x*2.*PI;
    return vec3(sin(theta)*cos(azimuth),sin(theta)*sin(azimuth),cos(theta));
}
vec2 skyViewUnitUV(vec3 localDirection,float radius){
    // atan2 retains precision at both poles and near the grazing-ray split.
    float horizon=skyHorizonAngle(radius),theta=atan(length(localDirection.xy),localDirection.z);
    float y=theta<horizon?.5*(1.-sqrt(max(0.,1.-theta/horizon))):
        .5+.5*sqrt(clamp((theta-horizon)/(PI-horizon),0.,1.));
    return vec2(fract(atan(localDirection.y,localDirection.x)/(2.*PI)+1.),y);
}
vec2 skyViewTextureUV(vec3 localDirection,float radius){
    return (skyViewUnitUV(localDirection,radius)*vec2(191,107)+.5)/vec2(192,108);
}
