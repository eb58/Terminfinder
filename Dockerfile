FROM php:8.3-apache

RUN a2enmod rewrite \
    && sed -ri 's/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

COPY index.html app.js styles.css api.php .htaccess /var/www/html/

RUN mkdir -p /var/www/html/data/polls \
    && chown -R www-data:www-data /var/www/html/data
