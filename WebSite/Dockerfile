# Use nginx to serve static files
FROM nginx:alpine

# Copy all website files to nginx html directory
COPY . /usr/share/nginx/html/

# Copy nginx config as template
COPY nginx.conf /etc/nginx/conf.d/default.conf.template

# Copy start script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Expose port (Railway will set PORT env var)
EXPOSE $PORT

# Start nginx with dynamic port
CMD ["/start.sh"]
