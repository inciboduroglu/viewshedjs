#!/usr/bin/env bash
echo "SHADE FILE ADDR:" $1
echo "NEW COLOR:" $2
echo "nv 0 0 0 0" > $1
echo $2 >> $1