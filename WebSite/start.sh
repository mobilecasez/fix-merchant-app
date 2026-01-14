#!/bin/sh

# Replace $PORT in nginx.conf with actual PORT value
envsubst '$PORT' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# Start nginx
nginx -g 'daemon off;'
