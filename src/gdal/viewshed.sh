#!/usr/bin/env bash
echo 'HOME:' $1
echo 'LOCATION NAME:' $2
echo 'INPUT PATH:' $3
echo 'OUTPUT PATH:' $4
echo 'OBSERVER COORDINATES:' $5
echo 'OBSERVER ELEVATION:' $6
echo 'RADIUS:' $7
echo 'SHADE FILE:' $8
echo 'TARGET ELEVATION:' $9
echo 'SOURCE PROJECTION:' $10

#HOME='/home/inci/grassdata/'
HOME=$1
LOCATION=${HOME}$2
PERMANENT=${LOCATION}'/PERMANENT'

grass74 -c $3 -e ${LOCATION}
grass74 ${PERMANENT} --exec r.external input=$3 output=elevation
grass74 ${PERMANENT} --exec g.region raster=elevation -p
grass74 ${PERMANENT} --exec r.viewshed input=elevation output=elev_out coordinates=$5 observer_elevation=$6 max_distance=$7 target_elevation=$9 -c
grass74 ${PERMANENT} --exec g.region raster=elev_out -p
# export calculated viewshed as tif file
grass74 ${PERMANENT} --exec r.out.gdal in=elev_out output=${LOCATION}'/temp_out.tif' type=UInt16 nodata=0 --overwrite -f
# change projection of the viewshed from 4326 to 3857
gdalwarp -s_srs EPSG:${10} -t_srs EPSG:3857 -dstalpha ${LOCATION}'/temp_out.tif' ${LOCATION}'/warped_temp_out.tif'
# import the changed projection as new location
VIEWSHED_LOCATION=${HOME}'/'$2'_viewshed'
START=$(date +%s.%N)
#gdal_translate -of PNG -ot Byte ${LOCATION}'/warped_temp_out.tif' $4
gdaldem color-relief -of PNG ${LOCATION}'/warped_temp_out.tif' -alpha $8 $4
END=$(date +%s.%N)
DIFF=$(echo "$END - $START" | bc)
echo "png took" ${DIFF}

# removes location after script is done
#rm -r ${VIEWSHED_LOCATION}
rm -r ${LOCATION} # temporary folder
rm -r ${LOCATION}.tif # temporary file