/* Legacy /lab/lesson → canonical course player, preserving ?m= and #sN. */
location.replace("/lab/course" + location.search + location.hash);
