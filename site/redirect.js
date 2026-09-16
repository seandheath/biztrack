const destination = new URL(document.querySelector('[data-destination]').href);
destination.search = location.search;
destination.hash = location.hash;
location.replace(destination.href);
