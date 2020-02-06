#!/usr/bin/env bash
echo 'Removing viewshed files'
echo 'FILE LOCATION' $1
if [ -z "$(ls -A "$1")" ]; then
	echo "No viewshed file"
else
	rm -r $1/*
	echo "Viewshed files deleted"
fi
