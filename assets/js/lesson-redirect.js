/* Legacy /lab/lesson.html → canonical course player, preserving ?m= and #sN. */
location.replace("/lab/course.html" + location.search + location.hash);
